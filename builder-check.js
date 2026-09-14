// Serializada por chrome.scripting.executeScript: não pode usar imports nem nada de fora da função.
export async function runFollowCheck(aliases) {
  const csrfToken = localStorage.getItem('aws-bingo-csrf-token') ?? '';
  const progress = (step, detail) => chrome.runtime.sendMessage({ type: 'progress', step, detail }).catch(() => {});

  async function call(path, body) {
    const response = await fetch(`https://api.builder.aws.com${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${path}`);
    return response.json();
  }

  const me = await call('/ums/profile/get', {}).catch(() => null);
  if (!me) return { error: 'Entre na sua conta do Builder Center e tente de novo.' };
  const { alias: myAlias, builderProfileId: myId } = me.profile.basicInfo;

  progress('profiles');
  const people = [];
  const failedAliases = [];
  for (let i = 0; i < aliases.length; i += 100) {
    const result = await call('/ums/profiles/aliases', { aliases: aliases.slice(i, i + 100) });
    failedAliases.push(...result.failedAliases);
    for (const { basicInfo } of result.profiles) {
      if (basicInfo.alias === myAlias) continue;
      people.push({
        alias: basicInfo.alias,
        name: basicInfo.name || basicInfo.alias,
        avatar: basicInfo.avatar,
        userId: basicInfo.builderProfileId,
        url: `https://builder.aws.com/community/@${basicInfo.alias}`,
      });
    }
  }

  progress('following');
  const followed = new Set();
  for (let i = 0; i < people.length; i += 100) {
    const result = await call('/ums/batchDoesFollowUser', { userIdList: people.slice(i, i + 100).map((p) => p.userId) });
    result.followedUserIds.forEach((id) => followed.add(id));
  }

  const followers = new Set();
  let nextToken;
  do {
    const result = await call('/ums/listUserFollowers', { userId: myId, maxResults: 50, nextToken });
    result.userFollowers.forEach((follower) => followers.add(follower.basicInfo.builderProfileId));
    nextToken = result.nextToken;
    progress('followers', followers.size);
  } while (nextToken);

  for (const person of people) {
    person.iFollow = followed.has(person.userId);
    person.followsMe = followers.has(person.userId);
  }

  return {
    me: { alias: myAlias },
    followingMe: people.filter((p) => p.followsMe),
    notFollowingMe: people.filter((p) => !p.followsMe),
    failedAliases,
  };
}
