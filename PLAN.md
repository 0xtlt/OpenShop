# Plan - Support multi-app Shopify

## Contexte

> OpenShop supporte aujourd'hui une seule app Shopify par instance via `SHOPIFY_API_KEY` et `SHOPIFY_API_SECRET`, tout en supportant plusieurs shops installes pour cette app. L'objectif est de supporter une seule instance OpenShop production connectee a plusieurs apps Shopify privees, par exemple une app par client, tout en gardant les scopes identiques entre apps et en supportant les setups avec fichiers Shopify TOML et sans TOML.

## Sujet 1

Condition de succes :
> La configuration publique permet de declarer plusieurs apps Shopify, avec ou sans TOML, sans casser le mode legacy actuel base sur les variables d'environnement existantes.

Taches :
- [x] Ajouter les types `shopify.apps` dans la config OpenShop.
- [x] Supporter le mode TOML avec `toml` + `apiSecret`.
- [x] Supporter le mode sans TOML avec `apiKey` + `apiSecret` + `appUrl`.
- [x] Garder le mode legacy si `shopify.apps` est absent.
- [x] Valider que les scopes restent globaux et ne sont pas definis par app dans OpenShop.

Informations complémentaires :
- Format cible hybride : TOML quand disponible, config explicite sinon.
- `apiSecret` reste toujours lu depuis l'environnement ou la config, jamais depuis un TOML.
- Les scopes doivent etre les memes pour toutes les apps d'une meme instance OpenShop.
- Implementation : types publics ajoutes dans `types.ts`, validation dans `config/validate.ts`, normalisation dans `server/shopify-apps.ts`.

## Sujet 2

Condition de succes :
> OpenShop resout de maniere fiable l'app Shopify courante pour chaque requete entrante signee, tokenisee ou initiee manuellement.

Taches :
- [x] Creer un resolver interne de Shopify app depuis les credentials normalises.
- [x] Resoudre l'app depuis le JWT App Bridge via `aud` puis verifier avec le secret correspondant.
- [x] Resoudre l'app sur HMAC OAuth, proxy, webhook et UI launch en testant les secrets configures.
- [x] Exiger `?app=<handle>` uniquement pour les entrees non signees comme `/auth?shop=...`.
- [x] Retourner une erreur explicite si aucune app ou plusieurs apps correspondent.

Informations complémentaires :
- L'auto-detection est possible pour les requetes signees ou tokenisees.
- Une URL non signee ne contient pas assez d'information fiable pour deviner l'app.

## Sujet 3

Condition de succes :
> Les installations, tokens, runs, provider configs et crons sont isoles par couple `(appHandle, shop)`.

Taches :
- [x] Ajouter `appHandle` aux tables framework concernees.
- [x] Migrer les donnees existantes vers `appHandle = 'default'`.
- [x] Remplacer l'unicite `installations.shop` par une unicite `(appHandle, shop)`.
- [x] Filtrer toutes les requetes serveur par `(appHandle, shop)` quand elles lisent des donnees shop-scoped.
- [x] Propager `appHandle` dans les dispatchs de flows et les crons.

Informations complémentaires :
- L'isolation complete a ete validee comme choix par defaut.
- Le meme shop installe via deux apps Shopify doit produire deux installations distinctes.

## Sujet 4

Condition de succes :
> OAuth, App Bridge, Shopify Admin API, proxy routes et webhooks fonctionnent avec la bonne app Shopify sans regression mono-app.

Taches :
- [x] Adapter `/auth` et `/auth/callback` pour utiliser l'app resolue.
- [x] Adapter l'injection App Bridge pour servir la bonne `apiKey` selon l'app courante.
- [x] Adapter `shopMiddleware` pour verifier les session tokens avec la bonne app.
- [x] Adapter `createShopifyClient` pour lire le token par `(appHandle, shop)`.
- [x] Ajouter `shopifyApp` aux contextes de flow, proxy et webhook.
- [x] Adapter proxy routes et webhooks pour verifier HMAC avec le secret de l'app resolue.

Informations complémentaires :
- Les fichiers `shopify.app*.toml` deviennent utiles comme source de verite Shopify, proche du modele Gadget.
- Les setups sans TOML restent supportes pour les deployments custom.

## Sujet 5

Condition de succes :
> Les tests, docs et templates prouvent que le mode legacy, le mode TOML multi-app et le mode sans TOML fonctionnent.

Taches :
- [x] Ajouter tests unitaires du resolver multi-app.
- [x] Ajouter tests integration OAuth/JWT/HMAC pour deux apps.
- [x] Ajouter tests d'isolation cross-app et cross-shop.
- [x] Mettre a jour docs configuration/production avec exemples TOML et sans TOML.
- [x] Mettre a jour le template minimal sans rendre le multi-app obligatoire.
- [x] Verifier `pnpm run check`, `pnpm --filter openshop test`, `pnpm --filter openshop run test:integration`, `pnpm --dir docs run check`, `pnpm --filter openshop run smoke:pack`.

Informations complémentaires :
- Les tests d'integration necessitent Postgres local, par exemple via `docker compose up -d postgres`.
- Le comportement legacy doit rester le chemin le plus simple pour une seule app Shopify.

## Commandes utiles

- `pnpm run check`
- `pnpm --filter openshop test`
- `docker compose up -d postgres`
- `pnpm --filter openshop run test:integration`
- `pnpm --dir docs run check`
- `pnpm --filter openshop run smoke:pack`
- `rg -n "SHOPIFY_API_KEY|SHOPIFY_API_SECRET|installations|verifySessionToken|verifyQueryHmac" packages/openshop/src`

## Questions ouvertes

- Aucune.

## Decisions validees

- Supporter le multi-app Shopify sur une seule instance OpenShop production.
- Ne pas definir les scopes par app dans `openshop.config.ts`.
- Les scopes doivent etre identiques entre client A et client B sur une meme instance.
- Supporter a la fois les apps declarees via TOML et les apps declarees sans TOML.
- Declarer les credentials multi-app dans `openshop.config.ts`.
- Isoler les donnees par `(appHandle, shop)`.
- Utiliser l'auto-detection quand Shopify fournit une signature ou un JWT.
- Exiger un `app` explicite seulement quand la requete n'est pas signee.
- Ne pas ajouter de helper CLI de diagnostic Shopify pour l'instant.
- Documenter explicitement que les TOML secondaires doivent etre deployes separement avec Shopify CLI.
- Implementation lancee apres go explicite de l'utilisateur.
