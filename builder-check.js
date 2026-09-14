// Esta funcao e serializada e injetada na aba do builder.aws.com.
// Por isso ela precisa ser autocontida: nada de imports ou variaveis externas.
// Roda na origem da pagina, entao herda o cookie de sessao e o CSRF token do usuario.
export async function runFollowCheck(aliases) {
  const API = 'https://api.builder.aws.com';
  const PROFILE_BATCH = 100;
  const FOLLOW_BATCH = 100;
  const FOLLOWERS_PAGE = 50;
  const MAX_FOLLOWER_PAGES = 400;

  const csrfToken = localStorage.getItem('aws-bingo-csrf-token');

  function report(step, detail) {
    try {
      chrome.runtime.sendMessage({ type: 'sbcl-progress', step, detail });
    } catch (e) {
      /* popup fechado: seguir sem progresso */
    }
  }

  async function call(path, body) {
    const response = await fetch(API + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken || '' },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      /* resposta nao-JSON cai no erro abaixo */
    }

    if (!response.ok) {
      const error = new Error((json && json.message) || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return json;
  }

  function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  function toCard(profile) {
    const info = (profile && profile.basicInfo) || {};
    return {
      alias: info.alias,
      name: info.name || info.alias,
      avatar: info.avatar || '',
      userId: info.builderProfileId,
      url: `https://builder.aws.com/community/@${info.alias}`,
    };
  }

  let me;
  try {
    me = await call('/ums/profile/get', {});
  } catch (error) {
    if (error.status === 401 || error.status === 403) return { ok: false, error: 'NOT_SIGNED_IN' };
    throw error;
  }

  const myInfo = (me && me.profile && me.profile.basicInfo) || {};
  const myUserId = myInfo.builderProfileId;
  const myAlias = (myInfo.alias || '').toLowerCase();

  // 1. alias -> perfil (endpoint publico, lotes de 100)
  report('profiles');
  const roster = [];
  const failedAliases = [];
  for (const group of chunk(aliases, PROFILE_BATCH)) {
    const result = await call('/ums/profiles/aliases', { aliases: group });
    for (const profile of result.profiles || []) roster.push(toCard(profile));
    for (const alias of result.failedAliases || []) failedAliases.push(alias);
  }

  const targets = roster.filter((p) => p.userId && p.alias.toLowerCase() !== myAlias);

  // 2. quem desses eu ja sigo
  report('following');
  const followedIds = new Set();
  for (const group of chunk(targets, FOLLOW_BATCH)) {
    const result = await call('/ums/batchDoesFollowUser', { userIdList: group.map((p) => p.userId) });
    for (const id of result.followedUserIds || []) followedIds.add(id);
  }

  // 3. quem me segue (nao existe versao em lote: pagina a lista inteira)
  const followerIds = new Set();
  let nextToken = null;
  let pages = 0;
  do {
    const body = { userId: myUserId, maxResults: FOLLOWERS_PAGE };
    if (nextToken) body.nextToken = nextToken;

    const result = await call('/ums/listUserFollowers', body);
    for (const follower of result.userFollowers || []) {
      const id = follower && follower.basicInfo && follower.basicInfo.builderProfileId;
      if (id) followerIds.add(id);
    }
    nextToken = result.nextToken || null;
    pages++;
    report('followers', followerIds.size);
  } while (nextToken && pages < MAX_FOLLOWER_PAGES);

  const people = targets.map((person) => ({
    ...person,
    iFollow: followedIds.has(person.userId),
    followsMe: followerIds.has(person.userId),
  }));

  return {
    ok: true,
    me: { alias: myInfo.alias, name: myInfo.name, userId: myUserId },
    followingMe: people.filter((p) => p.followsMe),
    notFollowingMe: people.filter((p) => !p.followsMe),
    failedAliases,
    truncatedFollowers: Boolean(nextToken),
    stats: {
      roster: people.length,
      iFollow: people.filter((p) => p.iFollow).length,
      followMe: people.filter((p) => p.followsMe).length,
      totalFollowers: followerIds.size,
    },
  };
}
