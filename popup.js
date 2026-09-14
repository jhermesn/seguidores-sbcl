import { fetchRoster } from './roster.js';
import { runFollowCheck } from './builder-check.js';

const BUILDER_URL = 'https://builder.aws.com/';
const BUILDER_MATCH = 'https://builder.aws.com/*';
const CACHE_KEY = 'lastReport';

const runButton = document.getElementById('run');
const statusLine = document.getElementById('status');
const results = document.getElementById('results');
const summary = document.getElementById('summary');
const warnings = document.getElementById('warnings');
const filterButtons = [...document.querySelectorAll('[data-filter]')];

let report = null;
const filters = { followingMe: 'all', notFollowingMe: 'all' };

const SECTIONS = [
  { key: 'followingMe', list: 'following-me', count: 'count-following-me', open: 'open-following-me', empty: 'Ninguém da lista te segue ainda.' },
  { key: 'notFollowingMe', list: 'not-following-me', count: 'count-not-following-me', open: 'open-not-following-me', empty: 'Todo mundo da lista já te segue.' },
];

const PROGRESS = {
  profiles: 'Resolvendo Builder IDs...',
  following: 'Checando quem você já segue...',
  followers: 'Lendo seus seguidores...',
};

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle('error', isError);
}

function describeAge(savedAt) {
  const minutes = Math.round((Date.now() - savedAt) / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;

  const days = Math.round(hours / 24);
  return `há ${days} d`;
}

function onProgress(message) {
  if (message.type !== 'sbcl-progress') return;
  const base = PROGRESS[message.step] || '';
  setStatus(message.detail ? `${base} (${message.detail})` : base);
}

async function openBuilderTab() {
  const [existing] = await chrome.tabs.query({ url: BUILDER_MATCH });
  if (existing) return { tabId: existing.id, created: false };

  const tab = await chrome.tabs.create({ url: BUILDER_URL, active: false });
  await new Promise((resolve) => {
    const onUpdated = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });

  return { tabId: tab.id, created: true };
}

function renderSummary(stats) {
  summary.replaceChildren(
    ...[
      [stats.roster, 'na lista'],
      [stats.followMe, 'te seguem'],
      [stats.roster - stats.iFollow, 'falta seguir'],
    ].map(([value, label]) => {
      const box = document.createElement('div');
      box.className = 'stat';

      const number = document.createElement('b');
      number.textContent = String(value);

      const caption = document.createElement('span');
      caption.textContent = label;

      box.append(number, caption);
      return box;
    })
  );
}

function renderSection(section) {
  const people = visiblePeople(section.key);
  const list = document.getElementById(section.list);
  const openButton = document.getElementById(section.open);

  document.getElementById(section.count).textContent = String(people.length);
  openButton.textContent = `Abrir todos (${people.length})`;
  openButton.disabled = people.length === 0;
  list.replaceChildren();

  if (people.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = filters[section.key] === 'all' ? section.empty : 'Ninguém neste filtro.';
    list.append(empty);
    return;
  }

  for (const person of people) {
    const item = document.createElement('li');

    const avatar = document.createElement('img');
    avatar.alt = '';
    if (person.avatar.startsWith('https://')) avatar.src = person.avatar;

    const who = document.createElement('div');
    who.className = 'who';

    const name = document.createElement('strong');
    name.textContent = person.name;

    const alias = document.createElement('span');
    alias.textContent = `@${person.alias}`;

    who.append(name, alias);

    const mark = document.createElement('span');
    mark.className = person.iFollow ? 'mark ok' : 'mark no';
    mark.textContent = person.iFollow ? 'OK' : 'X';
    mark.title = person.iFollow ? 'Você segue' : 'Você não segue';

    const link = document.createElement('a');
    link.href = person.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Abrir';

    item.append(avatar, who, mark, link);
    list.append(item);
  }
}

function renderWarnings(data, invalidRows) {
  const notes = [];
  if (data.failedAliases.length) {
    notes.push(`Builder IDs que não existem: ${data.failedAliases.join(', ')}`);
  }
  if (invalidRows.length) {
    notes.push(`Linhas da planilha em formato inválido: ${invalidRows.join(', ')}`);
  }
  if (data.truncatedFollowers) {
    notes.push('Lista de seguidores muito longa: resultado parcial.');
  }
  warnings.textContent = notes.join(' · ');
}

function show(data, invalid) {
  report = data;
  renderSummary(data.stats);
  for (const section of SECTIONS) renderSection(section);
  renderWarnings(data, invalid);
  results.hidden = false;
}

function visiblePeople(key) {
  const filter = filters[key];
  return report[key].filter((p) => filter === 'all' || p.iFollow === (filter === 'ok'));
}

function setFilter(key, value) {
  filters[key] = value;
  for (const button of filterButtons) {
    if (button.dataset.section === key) button.setAttribute('aria-pressed', String(button.dataset.filter === value));
  }
  renderSection(SECTIONS.find((section) => section.key === key));
}

function openAll(key) {
  for (const person of visiblePeople(key)) chrome.tabs.create({ url: person.url, active: false });
}

async function restoreCache() {
  const cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  if (!cache) return;

  show(cache.data, cache.invalid || []);
  runButton.textContent = 'Reescanear';
  setStatus(`@${cache.data.me.alias} · verificado ${describeAge(cache.savedAt)}.`);
}

async function run() {
  runButton.disabled = true;
  setStatus('Lendo a planilha...');

  let builderTab = null;
  chrome.runtime.onMessage.addListener(onProgress);

  try {
    const { aliases, invalid } = await fetchRoster();
    if (aliases.length === 0) throw new Error('A planilha não tem nenhum Builder ID válido.');

    setStatus(`${aliases.length} SBCLs na lista. Consultando o Builder Center...`);
    builderTab = await openBuilderTab();

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: builderTab.tabId },
      func: runFollowCheck,
      args: [aliases],
    });

    const data = injection.result;
    if (!data) throw new Error('A página do Builder Center não respondeu.');
    if (!data.ok) {
      setStatus('Entre na sua conta do Builder Center e tente de novo.', true);
      return;
    }

    show(data, invalid);
    await chrome.storage.local.set({ [CACHE_KEY]: { savedAt: Date.now(), data, invalid } });

    runButton.textContent = 'Reescanear';
    setStatus(`@${data.me.alias} · verificado agora mesmo.`);
  } catch (error) {
    setStatus(error.message || 'Falhou. Tente de novo.', true);
  } finally {
    chrome.runtime.onMessage.removeListener(onProgress);
    if (builderTab && builderTab.created) chrome.tabs.remove(builderTab.tabId);
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', run);
for (const section of SECTIONS) {
  document.getElementById(section.open).addEventListener('click', () => openAll(section.key));
}
for (const button of filterButtons) {
  button.addEventListener('click', () => setFilter(button.dataset.section, button.dataset.filter));
}
restoreCache();
