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

  const toPerson = ({ alias, name, avatar, builderProfileId }) => ({
    alias,
    name: name || alias,
    avatar,
    userId: builderProfileId,
    url: `https://builder.aws.com/community/@${alias}`,
  });

  const profile = await call('/ums/profile/get', {}).catch(() => null);
  if (!profile) return { error: 'Entre na sua conta do Builder Center e tente de novo.' };
  const me = toPerson(profile.profile.basicInfo);

  progress('profiles');
  const people = [];
  const failedAliases = [];
  for (let i = 0; i < aliases.length; i += 100) {
    const result = await call('/ums/profiles/aliases', { aliases: aliases.slice(i, i + 100) });
    failedAliases.push(...result.failedAliases);
    for (const { basicInfo } of result.profiles) {
      if (basicInfo.alias !== me.alias) people.push(toPerson(basicInfo));
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
    const result = await call('/ums/listUserFollowers', { userId: me.userId, maxResults: 50, nextToken });
    result.userFollowers.forEach((follower) => followers.add(follower.basicInfo.builderProfileId));
    nextToken = result.nextToken;
    progress('followers', followers.size);
  } while (nextToken);

  const everyone = [me, ...people];
  for (let i = 0; i < everyone.length; i += 10) {
    await Promise.all(
      everyone.slice(i, i + 10).map(async (person) => {
        const [followersCount, followingCount] = await Promise.all([
          call('/ums/getUserFollowersCount', { userId: person.userId }),
          call('/ums/getUserFollowingCount', { userId: person.userId }),
        ]);
        person.followers = followersCount.followersCount;
        person.following = followingCount.followingCount;
      })
    );
    progress('counts', `${Math.min(i + 10, everyone.length)}/${everyone.length}`);
  }

  for (const person of people) {
    person.iFollow = followed.has(person.userId);
    person.followsMe = followers.has(person.userId);
  }

  return {
    me,
    followingMe: people.filter((p) => p.followsMe),
    notFollowingMe: people.filter((p) => !p.followsMe),
    failedAliases,
  };
}
