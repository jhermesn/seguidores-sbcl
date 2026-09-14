# Seguidores - SBCL 🇧🇷

Extensão do Chrome para a ação de seguidores do AWS Builder Center entre SBCLs.

Você abre a extensão, clica em **Verificar** e vê duas listas:

- **SBCLs que me seguem** — cada um marcado `OK` (você já segue de volta) ou `X` (você ainda não segue)
- **SBCLs que não me seguem** — mesma marcação

A lista de participantes é lida **ao vivo** da planilha de respostas do formulário a cada execução. Quem preencher o formulário aparece na próxima verificação, sem atualizar a extensão.

O resultado fica salvo: ao reabrir a extensão, as listas já aparecem com a data da última verificação e o botão vira **Reescanear**.

## Instalar

1. Baixe o ZIP da release e descompacte.
2. Abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta descompactada.
5. Entre na sua conta em <https://builder.aws.com> — a extensão usa a sua sessão.

## Usar

Clique no ícone da extensão → **Verificar**. Para seguir alguém, clique em **Abrir** e use o botão Follow no perfil.

Nas próximas vezes o último resultado já está na tela. Clique em **Reescanear** para atualizar — o resultado antigo continua visível enquanto o novo é buscado.

A verificação leva de 30 s a alguns minutos: a API do Builder Center responde em ~4 s por chamada e a lista de seguidores é paginada de 50 em 50. O progresso aparece embaixo do botão.

## Como funciona

A extensão não tem servidor. Toda chamada sai do próprio navegador.

| Etapa | Endpoint | Auth |
|---|---|---|
| Ler o roster | CSV publicado do Google Sheets | — |
| Resolver `alias` → `builderProfileId` | `POST /ums/profiles/aliases` (lotes de 100) | público |
| Quem você já segue | `POST /ums/batchDoesFollowUser` (lotes de 100) | sessão |
| Quem te segue | `POST /ums/listUserFollowers` (páginas de 50) | sessão |

A API só aceita requisições da origem `https://builder.aws.com` (`Access-Control-Allow-Origin` fixo nessa origem), e a autenticação é cookie `HttpOnly` + header `x-csrf-token`. Por isso o popup injeta a consulta numa aba do Builder Center via `chrome.scripting.executeScript` em vez de chamar a API direto: é o único jeito de rodar dentro da origem certa, com a sua sessão. Se nenhuma aba do Builder Center estiver aberta, a extensão abre uma em segundo plano e fecha ao terminar.

Nada é enviado para fora: sem backend e sem telemetria. O último resultado é gravado em `chrome.storage.local`, que fica só na sua máquina e não sincroniza.

### Permissões

| Permissão | Por quê |
|---|---|
| `scripting` | injetar a consulta na aba do Builder Center |
| `tabs` | achar (ou abrir) a aba do Builder Center |
| `storage` | guardar o último resultado no próprio navegador |
| `host_permissions: https://builder.aws.com/*` | única origem que a extensão acessa |

Sem permissão para a API do Builder Center nem para o Google Sheets: a primeira é alcançada de dentro da própria página, e o CSV publicado responde com `Access-Control-Allow-Origin: *`.

## Trocar a planilha

O link fica em `roster.js`:

```js
export const ROSTER_CSV_URL = 'https://docs.google.com/.../pub?gid=...&single=true&output=csv';
```

Precisa ser um Google Sheets publicado na web como CSV (`Arquivo → Compartilhar → Publicar na web → CSV`). A coluna do Builder ID é achada pelo cabeçalho que contenha "Builder ID"; se nenhum casar, usa a última coluna.

Aceita `@alias`, `alias` ou a URL do perfil colada inteira. A API do Builder Center só aceita aliases `^[a-z0-9]+$` e **rejeita o lote inteiro** se um único alias tiver outro formato — por isso o parser filtra antes e lista as linhas descartadas no rodapé do popup.

## Estrutura

```
manifest.json      MV3, permissões
popup.html/css/js  UI e orquestração
roster.js          CSV do Sheets → lista de aliases
builder-check.js   função injetada na aba do Builder Center
```

`builder-check.js` é serializada por `executeScript`, então precisa continuar autocontida — sem imports e sem referência a variáveis de fora.

## Releases

Todo push na `main` passa pelo workflow de release. A versão sai dos [Conventional Commits](https://www.conventionalcommits.org/pt-br/) desde a última tag:

| Commit | Bump |
|---|---|
| `fix:` / `perf:` | patch |
| `feat:` | minor |
| `feat!:` ou `BREAKING CHANGE:` | major |
| `docs:` / `chore:` / `refactor:` / `test:` | nenhum — sem release |

A release leva `seguidores-sbcl.zip` (é este que você usa, via *Carregar sem compactação*) e, quando a chave de assinatura está configurada, `seguidores-sbcl.crx`.

O `manifest.json` do repositório fica numa versão base: a versão real é gravada nele durante o build, a partir da tag.

### Assinar o CRX (opcional)

O Chrome bloqueia `.crx` instalado fora da Web Store no Windows e no macOS — o arquivo serve para instalação por policy corporativa. Para habilitá-lo:

```sh
openssl genrsa -out key.pem 2048
gh secret set CRX_PRIVATE_KEY < key.pem
```

Guarde `key.pem` fora do repositório. É ela que define o ID da extensão: se mudar, o Chrome trata como outra extensão. Sem o secret, o workflow publica só o ZIP.

## Licença

MIT — veja [LICENSE](LICENSE).
