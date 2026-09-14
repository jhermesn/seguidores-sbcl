# Seguidores - SBCL 🇧🇷

Extensão do Chrome para a ação de seguidores entre os líderes estudantis no AWS Builder Center.

Clique em **Verificar** e veja duas listas, cada uma com filtro `Todos / OK / X` e botão **Abrir todos**:

- **SBCLs que me seguem**
- **SBCLs que não me seguem**

`OK` = você já segue · `X` = você ainda não segue.

A lista de líderes vem da página [Siga os outros líderes](https://www.lideresestudantis.app/seguir) a cada verificação. O último resultado fica salvo no navegador.

## Instalar

1. Baixe `seguidores-sbcl.zip` da [última release](../../releases/latest) e descompacte.
2. Em `chrome://extensions`, ligue o **Modo do desenvolvedor**.
3. **Carregar sem compactação** → escolha a pasta.
4. Entre em <https://www.lideresestudantis.app> e em <https://builder.aws.com>.

## Como funciona

| Etapa | Fonte |
|---|---|
| Lista de líderes | links `builder.aws.com/community/@alias` da página `/seguir` (sessão no app) |
| Alias → ID | `POST /ums/profiles/aliases` |
| Quem você segue | `POST /ums/batchDoesFollowUser` |
| Quem te segue | `POST /ums/listUserFollowers` |

A API do Builder Center só aceita a origem `https://builder.aws.com` e autentica por cookie + `x-csrf-token`, então a consulta roda injetada numa aba do Builder Center.

Aliases fora de `^[a-z0-9]+$` são erro de cadastro no app e aparecem no rodapé, junto com os que não existem no Builder Center.

## Releases

Push na `main` gera release pelos [Conventional Commits](https://www.conventionalcommits.org/pt-br/): `fix:` → patch, `feat:` → minor, `feat!:` → major. Outros tipos não geram release.

## Licença

[MIT](LICENSE)
