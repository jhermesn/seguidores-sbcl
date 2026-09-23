const CACHE_KEY = 'lastReport';
const PROFILE_PATH = '/community/@';

// So o perfil em si: /community/@alias. Links como /community/@alias/network
// sao contadores de seguidores, nao a pessoa.
const aliasOf = (path) => {
  if (!path.startsWith(PROFILE_PATH)) return null;
  const alias = path.slice(PROFILE_PATH.length);
  return alias && !alias.includes('/') ? alias.toLowerCase() : null;
};

let leaders = new Set();

// Link inline recebe a tag direto. Quando o link envolve a linha inteira
// (Notifications, pagina de rede), colocar nele jogaria a tag pra outra linha,
// entao miramos no elemento do nome: o negrito quando existe, senao o primeiro
// elemento com texto.
function inlineTarget(link) {
  // <a> nasce inline; so links do tamanho da linha reportam bloco.
  if ((getComputedStyle(link).display || 'inline').startsWith('inline')) return link;

  const negrito = [...link.querySelectorAll('b, strong')].find((el) => el.textContent.trim());
  if (negrito) return negrito;

  const textos = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  for (let node = textos.nextNode(); node; node = textos.nextNode()) {
    if (node.textContent.trim()) return node.parentElement;
  }
  return null;
}

function tag(element) {
  const badge = document.createElement('span');
  badge.className = 'builder-tag sbcl';
  badge.textContent = 'SBCL';
  element.append(badge);
}

function paint() {
  if (!leaders.size) return;

  const profileAlias = aliasOf(location.pathname);
  const heading = document.querySelector('h1');
  if (profileAlias && heading && !heading.dataset.sbcl && leaders.has(profileAlias)) {
    heading.dataset.sbcl = 'on';
    tag(heading);
  }

  for (const link of document.querySelectorAll(`a[href^="${PROFILE_PATH}"], a[href*="builder.aws.com${PROFILE_PATH}"]`)) {
    // Cada pessoa aparece duas vezes: no avatar (sem texto) e no nome.
    if (link.dataset.sbcl || !link.textContent.trim()) continue;
    link.dataset.sbcl = 'on';
    if (!leaders.has(aliasOf(new URL(link.href).pathname))) continue;

    const alvo = inlineTarget(link);
    if (alvo) tag(alvo);
  }
}

chrome.storage.local.get(CACHE_KEY).then(({ [CACHE_KEY]: cache }) => {
  if (!cache) return;
  leaders = new Set(
    [cache.data.me, ...cache.data.followingMe, ...cache.data.notFollowingMe].map((person) => person.alias?.toLowerCase()).filter(Boolean)
  );
  paint();
});

let repaint;
new MutationObserver(() => {
  clearTimeout(repaint);
  repaint = setTimeout(paint, 300);
}).observe(document.body, { childList: true, subtree: true });
