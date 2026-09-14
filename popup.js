import { fetchRoster } from './roster.js';
import { runFollowCheck } from './builder-check.js';

const CACHE_KEY = 'lastReport';
const PROGRESS = {
  profiles: 'Resolvendo Builder IDs...',
  following: 'Checando quem você já segue...',
  followers: 'Lendo seus seguidores...',
};

const $ = (selector, root = document) => root.querySelector(selector);
const runButton = $('#run');
const groups = [...document.querySelectorAll('.group')];
const relativeTime = new Intl.RelativeTimeFormat('pt-BR');

let report;

function setStatus(message, isError = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', isError);
}

function describeAge(savedAt) {
  const minutes = Math.round((savedAt - Date.now()) / 60000);
  if (minutes === 0) return 'agora mesmo';
  if (minutes > -60) return relativeTime.format(minutes, 'minute');
  if (minutes > -1440) return relativeTime.format(Math.round(minutes / 60), 'hour');
  return relativeTime.format(Math.round(minutes / 1440), 'day');
}

function onProgress({ type, step, detail }) {
  if (type === 'progress') setStatus(detail ? `${PROGRESS[step]} (${detail})` : PROGRESS[step]);
}

async function openBuilderTab() {
  const [existing] = await chrome.tabs.query({ url: 'https://builder.aws.com/*' });
  if (existing) return { id: existing.id, created: false };

  const tab = await chrome.tabs.create({ url: 'https://builder.aws.com/', active: false });
  await new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function onUpdated(tabId, info) {
      if (tabId !== tab.id || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    });
  });
  return { id: tab.id, created: true };
}

function visiblePeople(group) {
  const filter = group.dataset.active ?? 'all';
  return report[group.dataset.key].filter((p) => filter === 'all' || p.iFollow === (filter === 'ok'));
}

function renderPerson(person) {
  const item = $('#person').content.cloneNode(true);
  if (person.avatar) $('img', item).src = person.avatar;
  $('strong', item).textContent = person.name;
  $('.who span', item).textContent = `@${person.alias}`;
  $('.mark', item).textContent = person.iFollow ? 'OK' : 'X';
  $('.mark', item).classList.add(person.iFollow ? 'ok' : 'no');
  $('a', item).href = person.url;
  return item;
}

function renderGroup(group) {
  const people = visiblePeople(group);
  $('.count', group).textContent = people.length;
  $('.open-all', group).textContent = `Abrir todos (${people.length})`;
  $('.open-all', group).disabled = people.length === 0;

  if (people.length) {
    $('.people', group).replaceChildren(...people.map(renderPerson));
    return;
  }
  const empty = document.createElement('li');
  empty.className = 'empty';
  empty.textContent = group.dataset.active && group.dataset.active !== 'all' ? 'Ninguém neste filtro.' : group.dataset.empty;
  $('.people', group).replaceChildren(empty);
}

function show(data, invalid) {
  report = data;
  const everyone = [...data.followingMe, ...data.notFollowingMe];
  $('#stat-roster').textContent = everyone.length;
  $('#stat-follow-me').textContent = data.followingMe.length;
  $('#stat-to-follow').textContent = everyone.filter((p) => !p.iFollow).length;

  groups.forEach(renderGroup);

  $('#warnings').textContent = [
    data.failedAliases.length && `Builder IDs que não existem: ${data.failedAliases.join(', ')}`,
    invalid.length && `Builder IDs cadastrados errado no app: ${invalid.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ');

  $('#results').hidden = false;
  runButton.textContent = 'Reescanear';
}

async function run() {
  runButton.disabled = true;
  setStatus('Lendo a lista de líderes...');
  chrome.runtime.onMessage.addListener(onProgress);
  let builderTab;

  try {
    const { aliases, invalid } = await fetchRoster();
    if (!aliases.length) throw new Error('A lista de líderes veio vazia.');

    setStatus(`${aliases.length} líderes na lista. Consultando o Builder Center...`);
    builderTab = await openBuilderTab();

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: builderTab.id },
      func: runFollowCheck,
      args: [aliases],
    });
    if (!result) throw new Error('O Builder Center não respondeu. Tente de novo.');
    if (result.error) throw new Error(result.error);

    show(result, invalid);
    await chrome.storage.local.set({ [CACHE_KEY]: { savedAt: Date.now(), data: result, invalid } });
    setStatus(`@${result.me.alias} · verificado agora mesmo.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    chrome.runtime.onMessage.removeListener(onProgress);
    if (builderTab?.created) chrome.tabs.remove(builderTab.id);
    runButton.disabled = false;
  }
}

for (const group of groups) {
  const buttons = [...group.querySelectorAll('[data-filter]')];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      group.dataset.active = button.dataset.filter;
      buttons.forEach((other) => other.setAttribute('aria-pressed', other === button));
      renderGroup(group);
    });
  }
  $('.open-all', group).addEventListener('click', () => {
    for (const person of visiblePeople(group)) chrome.tabs.create({ url: person.url, active: false });
  });
}

runButton.addEventListener('click', run);

const cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
if (cache) {
  show(cache.data, cache.invalid ?? []);
  setStatus(`@${cache.data.me.alias} · verificado ${describeAge(cache.savedAt)}.`);
}

import('./teste.js')
  .then(({ setup }) => setup({ setStatus, openBuilderTab, report: () => report }))
  .catch(() => {});

