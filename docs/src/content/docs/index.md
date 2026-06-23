---
title: OpenShop
description: Code Shopify workflows, typed provider configuration, and the embedded admin UI without repetitive boilerplate.
template: splash
tableOfContents: false
---

<div class="os-home">
<section class="os-hero" aria-labelledby="openshop-hero-title">
<div class="os-hero__copy">
<h1 id="openshop-hero-title">Code Shopify workflows. Ship the admin UI with it.</h1>
<p>OpenShop turns the integration work around Shopify into typed TypeScript primitives: checkpointed flows, provider config screens, encrypted secrets, logs, retries, webhooks, proxy routes, and function instances.</p>
<div class="os-actions" aria-label="Primary documentation links">
<a class="os-button os-button--primary" href="/getting-started/">Get started</a>
<a class="os-button os-button--secondary" href="/flows/">Read the flows guide</a>
</div>
</div>
<div class="os-hero__product" aria-label="OpenShop workflow and provider configuration preview">
<div class="os-code-panel">
<div class="os-window-bar" aria-hidden="true"><span></span><span></span><span></span></div>
<pre><code><span class="os-token os-token--muted">import</span> { defineFlow } <span class="os-token os-token--muted">from</span> <span class="os-token os-token--string">'openshop'</span>
<span class="os-token os-token--muted">export const</span> syncOrders = defineFlow({
  name: <span class="os-token os-token--string">'Sync orders'</span>,
  <span class="os-token os-token--accent">async</span> run(ctx) {
    <span class="os-token os-token--accent">const</span> orders = <span class="os-token os-token--call">await ctx.step</span>(
      <span class="os-token os-token--string">'flow.step("sync orders")'</span>,
      () =&gt; ctx.shopify.graphql(query)
    )
    <span class="os-token os-token--call">await ctx.provider</span>(<span class="os-token os-token--string">'warehouse'</span>)
      .send(orders)
  },
})</code></pre>
</div>
<div class="os-config-panel">
<div class="os-panel-heading"><span>Provider config</span><strong>warehouse</strong></div>
<div class="os-field"><span>Endpoint</span><strong>https://api.partner.test</strong></div>
<div class="os-field"><span>API key</span><strong>Encrypted secret</strong></div>
<div class="os-status-grid"><span>Retries</span><strong>3 attempts</strong><span>Logs</span><strong>Live tail</strong></div>
</div>
</div>
</section>
<section class="os-proof" aria-label="OpenShop product pillars">
<a class="os-proof__item" href="/flows/"><span>01</span><strong>Workflows that resume cleanly</strong><p>Each step is checkpointed, so retries continue from the useful boundary instead of replaying the whole job.</p></a>
<a class="os-proof__item" href="/providers/"><span>02</span><strong>Config UI from provider definitions</strong><p>Declare fields, validation, health checks, and secrets once. OpenShop renders the embedded admin surface.</p></a>
<a class="os-proof__item" href="/production/"><span>03</span><strong>Operations already wired</strong><p>Runs, logs, crons, workers, proxy routes, webhooks, MCP tokens, and Shopify Functions stay in one framework.</p></a>
</section>
<section class="os-workflow" aria-labelledby="openshop-workflow-title">
<div>
<h2 id="openshop-workflow-title">A framework for the boring parts around the useful code.</h2>
<p>You write the flow and provider boundaries. OpenShop owns the lifecycle around them: scheduling, retries, cancellation, encrypted config, generated admin pages, and typed Shopify calls.</p>
</div>
<ol class="os-steps">
<li><span>Define</span><strong>Flows, providers, webhooks, proxy routes</strong></li>
<li><span>Generate</span><strong>Admin config, operation types, framework tables</strong></li>
<li><span>Operate</span><strong>Runs, logs, crons, workers, MCP access</strong></li>
</ol>
</section>
<section class="os-links" aria-label="Suggested next documentation pages">
<a href="/getting-started/">Create and run an app</a>
<a href="/configuration/">Configure providers and crons</a>
<a href="/graphql-codegen/">Use typed Shopify GraphQL</a>
<a href="/proxy-routes/">Expose proxy routes</a>
</section>
</div>
