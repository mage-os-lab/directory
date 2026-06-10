# Mage-OS Extension Directory

> **Superseded.** These are the original scoping notes, kept for history. The decided
> design lives in [architecture.md](architecture.md) and [decisions.md](decisions.md).
> Notably, the two-source design sketched below (PackageMaven + Packagist) was simplified
> to PackageMaven-only — see decision 2.

Want to create an interface that allows people to explore and discover available open source and free modules (and services) via the Mage-OS admin panel, or possibly also mage-os.org

Some context: https://github.com/orgs/mage-os-lab/discussions/3

I can help flesh out the idea.

***

Let me also check the referenced project to see what ground's already been covered.

Got it. So rhoerr's proposal is a module discovery tool for Mage-OS — admin-panel-integrated, read-only in production, surfacing installed + available open-source packages with trust signals. The referenced magento2-composer-dashboard likely covers the "what's installed" side via composer.lock introspection.

Good starting point. Where do you want to dig in? A few angles that immediately come to mind:

* Data source & indexing — Where does the "available packages" catalog live? Packagist metadata, a curated Mage-OS registry, or both? How do you keep it fresh without hammering Packagist on every admin page load? A synced index (cron-based or push-updated) seems inevitable.
* Trust indicators — The discussion mentions partner levels, "Trusted", quality scores, test status. That's a separate data layer on top of Packagist. Needs its own API/registry service. Who curates it — automated (CI results, download stats, abandon detection) vs. manual (Mage-OS review board)?
* Admin integration vs. standalone — An admin module is the obvious UX, but it introduces coupling to Magento's admin auth, layout, and version constraints. A standalone web app (or even CLI tool) that the admin module just embeds via iframe/API might give more flexibility.
* Security boundary — "No install from admin" is smart, but how far does it go? Is it literally view-only, or does it generate a composer require command you copy-paste? Does it detect version conflicts before you even try?

What's your take, and which part do you want to spec out?

***

* Data source -- both, ish -- Mage-OS would have to have a supplemental data source of some kind. Architecture thereof totally TBD. Maybe we could integrate with https://package-maven.com/ in some way as far as packagist is concerned, to get open source packages along with quality indicators.
* Trust -- combo of automated and manual by Mage-OS
* Container -- no CLI tool, at least not yet. Something that gets loaded into the admin panel by iframe or API (!) could work. I like the idea of something that can work inside or independently of Mage-OS.
* Security -- composer require command. No dependency resolution or conflict detection at this point.

Initial thoughts?

***

PackageMaven is a strong fit — it already has categorization, quality tiers (Strict Compliant → Needs Help), compatibility badges, PHPStan levels, build status, and install counts across 748 modules. That's most of the "available packages + quality indicators" layer done.

Here's how I'd sketch the architecture:

Two-tier system:

Mage-OS Discovery Service — a lightweight standalone app (likely Node or PHP, your call) that aggregates data from PackageMaven's API (or scrapes if no API exists yet — worth reaching out to Jiří Brada), Packagist metadata, and a Mage-OS-curated trust overlay (partner levels, manual "Trusted" badges, editorial picks). Exposes a clean REST/GraphQL API. Runs independently — could be hosted by Mage-OS infra.
Admin module — thin Magento module that does two things: reads composer.lock + composer.json to show what's installed (the composer-dashboard angle), and embeds the Discovery Service UI via iframe or fetches its API to render a browsable catalog in-admin. The "install" action is just copying a composer require vendor/module:^x.y command to clipboard.
Why this split matters:

The Discovery Service is useful beyond the admin panel — it could power a public website, a future CLI tool, IDE plugins, CI checks ("are any of your deps flagged?"). Keeping it decoupled from Magento means faster iteration, no Magento version coupling, and the community can contribute without needing a full Magento dev environment.

Key decisions to nail down early:

Does PackageMaven have (or plan) a public API? If not, mirroring their data on a schedule via scraping is fragile. A partnership/data-sharing agreement would be much better.
Mage-OS trust overlay storage — simple enough as a GitHub-hosted JSON/YAML repo that the Discovery Service pulls from. Low ceremony, PR-based curation, version-controlled history.
Admin module's installed-package view: parse composer.lock directly, or lean on composer show --format=json? The latter is richer but requires shell access from PHP, which some hosting restricts.
For the admin module specifically:

I'd lean toward API-fetched UI over iframe. An iframe is simpler to ship but feels foreign in the admin — no theme consistency, no integration with Magento's notification/message system, harder to cross-reference installed vs. available. A lightweight React/Alpine component hitting the Discovery Service API, rendered in a standard admin page, gives you native look-and-feel with minimal coupling.

