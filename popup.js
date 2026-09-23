import { fetchRoster } from './roster.js';
import { runFollowCheck } from './builder-check.js';

const CACHE_KEY = 'lastReport';
const TOP_SIZE = 10;
const PAGE_SIZE = 25;
const PROGRESS = {
  profiles: 'Resolvendo Builder IDs...',
  following: 'Checando quem você já segue...',
  followers: 'Lendo seus seguidores...',
  counts: 'Contando seguidores de cada líder...',
};

const $ = (selector, root = document) => root.querySelector(selector);
const runButton = $('#run');
const groups = [...document.querySelectorAll('.group')];
const relativeTime = new Intl.RelativeTimeFormat('pt-BR');

let report;
let savedAt;
let busy = false;

// Um scan de cada vez: o popup e o painel de testes compartilham esta trava.
function setBusy(on) {
  busy = on;
  runButton.disabled = on;
  for (const button of document.querySelectorAll('.scan')) button.disabled = on;
}

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

function pageOf(group) {
  const people = visiblePeople(group);
  const pages = Math.max(1, Math.ceil(people.length / PAGE_SIZE));
  const page = Math.min(Number(group.dataset.page ?? 0), pages - 1);
  return { people, pages, page, slice: people.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) };
}

function turnPage(group, step) {
  const { page, pages } = pageOf(group);
  group.dataset.page = Math.min(Math.max(page + step, 0), pages - 1);
  renderGroup(group);
}

const everyoneIn = (data) => [data.me, ...data.followingMe, ...data.notFollowingMe];

// Vazio quando a metrica nao mudou ou quando nao ha scan anterior pra comparar.
function diffTag(delta) {
  if (!delta) return '';
  const tag = document.createElement('span');
  tag.className = delta > 0 ? 'diff up' : 'diff down';
  tag.textContent = delta > 0 ? ` (+${delta})` : ` (${delta})`;
  return tag;
}

function describePerson(person) {
  return [
    `@${person.alias} - ${person.followers} seguidores`,
    diffTag(person.diffFollowers),
    `, ${person.following} seguindo`,
    diffTag(person.diffFollowing),
  ];
}

const plainText = (parts) => parts.map((part) => part.textContent ?? part).join('');

// Quanto cada metrica andou desde o scan anterior. Fica gravado junto do
// relatorio, entao o popup reaberto mostra a mesma variacao.
function diffAgainstLastScan(fresh, previous, previousSavedAt) {
  if (!previous) return;

  const before = new Map(everyoneIn(previous).map((person) => [person.userId, person]));
  for (const person of everyoneIn(fresh)) {
    const old = before.get(person.userId);
    if (!old) continue;
    person.diffFollowers = person.followers - old.followers;
    person.diffFollowing = person.following - old.following;
  }
  fresh.comparedTo = previousSavedAt;
}

function describeScan(data, when) {
  const variation = data.comparedTo ? ` · mudanças desde o scan anterior (${describeAge(data.comparedTo)})` : '';
  return `@${data.me.alias} · verificado ${describeAge(when)}${variation}.`;
}

function renderPerson(person) {
  const item = $('#person').content.cloneNode(true);
  if (person.avatar) $('img', item).src = person.avatar;
  $('strong', item).textContent = person.name;
  $('.who span', item).append(...describePerson(person));
  $('a', item).href = person.url;

  const mark = $('.mark', item);
  const isMe = person.userId === report.me.userId;
  mark.textContent = isMe ? 'você' : person.iFollow ? 'OK' : 'X';
  mark.classList.add(isMe || person.iFollow ? 'ok' : 'no');
  return item;
}

function copyGroup(group) {
  const title = $('h2', group).firstChild.textContent.trim();
  const lines = visiblePeople(group).map((person) => plainText(describePerson(person)));
  navigator.clipboard.writeText([title, ...lines].join('\n'));
  setStatus(`${lines.length} copiados de "${title}".`);
}

function renderGroup(group) {
  const { people, pages, page, slice } = pageOf(group);
  const openPage = $('.open-all', group);

  $('.count', group).textContent = people.length;
  $('.copy', group).disabled = people.length === 0;

  if (openPage) {
    $('.badge', openPage).textContent = slice.length;
    openPage.disabled = slice.length === 0;
    $('.page', group).textContent = `${page + 1}/${pages}`;
    $('.prev', group).disabled = page === 0;
    $('.next', group).disabled = page === pages - 1;
  }

  if (slice.length) {
    $('.people', group).replaceChildren(...slice.map(renderPerson));
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
  data.top = [data.me, ...everyone].sort((a, b) => b.followers - a.followers).slice(0, TOP_SIZE);
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
  if (busy) return;
  setBusy(true);
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

    diffAgainstLastScan(result, report, savedAt);
    savedAt = Date.now();
    show(result, invalid);
    await chrome.storage.local.set({ [CACHE_KEY]: { savedAt, data: result, invalid } });
    setStatus(describeScan(result, savedAt));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    chrome.runtime.onMessage.removeListener(onProgress);
    if (builderTab?.created) chrome.tabs.remove(builderTab.id);
    setBusy(false);
  }
}

for (const group of groups) {
  const buttons = [...group.querySelectorAll('[data-filter]')];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      group.dataset.active = button.dataset.filter;
      group.dataset.page = 0;
      buttons.forEach((other) => other.setAttribute('aria-pressed', other === button));
      renderGroup(group);
    });
  }
  $('.open-all', group)?.addEventListener('click', () => {
    for (const person of pageOf(group).slice) chrome.tabs.create({ url: person.url, active: false });
  });
  $('.prev', group)?.addEventListener('click', () => turnPage(group, -1));
  $('.next', group)?.addEventListener('click', () => turnPage(group, 1));
  $('.copy', group).addEventListener('click', () => copyGroup(group));
}

runButton.addEventListener('click', run);

// A barra de rolagem some 1s depois do ultimo scroll.
document.addEventListener(
  'scroll',
  ({ target }) => {
    if (!target.classList?.contains('people')) return;
    target.classList.add('scrolling');
    clearTimeout(target.hideScrollbar);
    target.hideScrollbar = setTimeout(() => target.classList.remove('scrolling'), 1000);
  },
  true
);

const cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
if (cache?.data.me.followers !== undefined) {
  savedAt = cache.savedAt;
  show(cache.data, cache.invalid ?? []);
  setStatus(describeScan(cache.data, savedAt));
}

import('./teste.js')
  .then(({ setup }) => setup({ setStatus, openBuilderTab, report: () => report, setBusy, isBusy: () => busy }))
  .catch(() => {});

