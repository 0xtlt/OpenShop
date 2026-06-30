import { defineOpenShop } from "openshop";
import { warehouse } from "#providers/warehouse";

export const app = defineOpenShop({
  // Single-app projects can keep Shopify credentials in env/TOML.
  // Add `shopify.apps` only when one OpenShop instance must serve several Shopify apps.
  providers: { warehouse },
});
