const ROSTER_URL = 'https://www.lideresestudantis.app/seguir';
const PROFILE_PREFIX = 'https://builder.aws.com/community/@';

// A API do Builder Center rejeita o lote inteiro se um alias fugir deste formato.
const VALID_ALIAS = /^[a-z0-9]+$/;

export async function fetchRoster() {
  const response = await fetch(ROSTER_URL, { credentials: 'include', cache: 'no-store' });

  if (new URL(response.url).pathname !== '/seguir') {
    throw new Error('Entre na sua conta em lideresestudantis.app e tente de novo.');
  }
  if (!response.ok) {
    throw new Error(`Não consegui ler a lista de líderes (HTTP ${response.status}).`);
  }

  const page = new DOMParser().parseFromString(await response.text(), 'text/html');
  const links = page.querySelectorAll(`a[href^="${PROFILE_PREFIX}"]`);
  const aliases = [...new Set([...links].map((link) => new URL(link.href).pathname.split('@')[1].toLowerCase()))];

  return {
    aliases: aliases.filter((alias) => VALID_ALIAS.test(alias)),
    invalid: aliases.filter((alias) => !VALID_ALIAS.test(alias)),
  };
}
