<script lang="ts">
  import { onDestroy } from 'svelte';
  import Adapters from './components/Adapters.svelte';
  import CodePanel from './components/CodePanel.svelte';
  import Icon from './components/Icon.svelte';
  import Playground from './components/Playground.svelte';
  import Routing from './components/Routing.svelte';

  const github =
    'https://github.com/WingSMC/invoker';
  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout>;
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast = 'Copied to clipboard';
    } catch {
      toast =
        'Clipboard unavailable. Select and copy the snippet.';
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = '';
    }, 2500);
  }
  onDestroy(() => clearTimeout(toastTimer));
</script>

<svelte:head
  ><meta
    name="color-scheme"
    content="dark"
  /></svelte:head
>
<div
  class="pointer-events-none absolute inset-x-0 top-0 h-200 bg-hero-glow"
  aria-hidden="true"
></div>
<div
  id="top"
  class="relative mx-auto w-page max-w-295 sm:w-page-wide"
>
  <header
    class="flex h-20 items-center justify-between sm:h-24"
    ><a
      href="#top"
      aria-label="invoker home"
      class="flex items-center text-brand font-semibold tracking-tight"
      ><span
        class="mr-2.5 grid size-8 place-items-center rounded-lg border border-lilac/30 bg-lilac/5 text-lilac"
        ><Icon size={20} /></span
      >invoker<span class="text-lilac">.</span></a
    ><nav
      aria-label="Main navigation"
      class="flex items-center gap-4 text-detail text-nav sm:gap-8 sm:text-sm"
      ><a
        href="#playground"
        class="transition-colors hover:text-lilac"
        >Playground</a
      ><a
        href="#code"
        class="transition-colors hover:text-lilac"
        >The code</a
      ><a
        href={github}
        target="_blank"
        rel="noreferrer"
        class="rounded-lg border border-white/8 bg-white/1 px-3 py-2.5 hover:border-lilac/30"
        >GitHub <span class="ml-2 text-dim"
          >↗</span
        ></a
      ></nav
    ></header
  >
  <main>
    <section
      class="grid items-center gap-2 pt-9 pb-10 text-center lg:min-h-126.25 lg:grid-cols-hero lg:pt-8 lg:pb-16 lg:text-left"
    >
      <div
        ><div
          class="flex items-center justify-center gap-2 font-mono text-caption tracking-eyebrow text-eyebrow lg:justify-start"
          ><span
            class="size-1 rounded-full bg-sage shadow-status"
          ></span>A SMALL LIBRARY. A LITTLE
          SUPERPOWER.</div
        ><h1
          class="mt-7 mb-6 text-hero leading-hero font-medium -tracking-hero sm:text-hero-wide"
          >Your AI thinks.<br /><span
            class="bg-linear-to-r from-hero-start to-hero-end bg-clip-text text-transparent"
            >invoker acts.</span
          ></h1
        ><p
          class="mb-8 text-body-sm leading-7 text-hero-copy"
          >A typed bridge between AI streams and
          your functions.<br
            class="hidden sm:block"
          />Register. Validate. Execute. Keep the
          stream flowing.</p
        ><div
          class="flex flex-wrap items-center justify-center gap-3 lg:justify-start"
          ><a
            href="#playground"
            class="flex items-center gap-5 rounded-lg border border-action-border bg-lilac px-4 py-3 text-sm font-semibold text-action-ink transition-transform hover:-translate-y-0.5 hover:shadow-action motion-reduce:transform-none"
            >See it in action<Icon
              name="arrow"
              size={18}
            /></a
          ><button
            onclick={() =>
              copy(
                'pnpm add @wingsmc/invoker effect zod',
              )}
            aria-label="Copy install command"
            class="flex items-center gap-2.5 rounded-lg border border-white/8 bg-white/1 px-3.5 py-3.5 font-mono text-label text-install hover:border-lilac/35"
            ><span class="text-install-prefix"
              >$</span
            >pnpm add @wingsmc/invoker effect zod<span
              class="ml-2 text-install-icon"
              ><Icon
                name="copy"
                size={14}
              /></span
            ></button
          ></div
        ><div
          class="mt-7 flex justify-center gap-5 font-mono text-caption text-badge lg:justify-start"
          >{#each ['TypeScript 6', 'Zod + Effect', 'Streaming middleware'] as tag}<span
              class="flex items-center gap-2"
              ><span
                class="size-0.5 rounded-full bg-lilac/50"
              ></span>{tag}</span
            >{/each}</div
        ></div
      >
      <Routing />
    </section>
    <div
      class="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-y border-white/6 py-6 text-label text-stat-label sm:justify-between"
      ><span class="hidden sm:inline"
        >Small by design.</span
      ><span
        data-testid="build-size"
        title="Gzipped dist/index.js from the library build; external peers, declarations, and source maps excluded."
        ><strong
          class="mr-2 font-mono font-normal text-stat-value"
          >{import.meta.env.VITE_INVOKER_GZIP_KB} KB</strong
        >gzip library*</span
      ><span
        ><strong
          class="mr-2 font-mono font-normal text-stat-value"
          >0</strong
        >SDK runtime dependencies</span
      ><span
        ><strong
          class="mr-2 font-mono font-normal text-stat-value"
          >100%</strong
        >typed arguments</span
      ><span class="hidden text-caption lg:inline"
        >* excluding peers</span
      ></div
    >
    <section
      id="playground"
      class="pt-16 sm:pt-24"
      ><div
        class="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"
        ><div
          ><span
            class="font-mono text-caption tracking-wider text-section-label"
            >01 / THE PLAYGROUND</span
          ><h2
            class="mt-4 mb-3 text-section font-normal tracking-tight sm:text-title"
            >Follow a call from thought to action.</h2
          ><p class="text-body text-section-copy"
            >A simulated AI. Real middleware.
            Every step, visible.</p
          ></div
        ></div
      ><Playground /><p
        class="mt-5 text-center text-label leading-5 text-demo-note"
        ><span class="mr-1 text-lilac">✧</span
        >Every result comes from the registered
        handler. The mock model streams a scripted
        response based on that result.</p
      ></section
    >
    <section
      id="code"
      class="pt-20 sm:pt-26"
      ><div
        class="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"
        ><div
          ><span
            class="font-mono text-caption tracking-wider text-section-label"
            >02 / THE CODE</span
          ><h2
            class="mt-4 mb-3 text-section font-normal tracking-tight sm:text-title"
            >Less plumbing. More possibility.</h2
          ><p class="text-body text-section-copy"
            >Bring your functions. We’ll handle
            the handoff.</p
          ></div
        ><a
          href={`${github}#readme`}
          target="_blank"
          rel="noreferrer"
          class="pb-1 text-detail text-docs-link hover:text-lilac"
          >Read the documentation ↗</a
        ></div
      ><CodePanel oncopy={copy} /></section
    >
    <Adapters oncopy={copy} />
    <section
      class="mt-16 grid gap-8 border-t border-white/6 pt-9 md:grid-cols-3 md:gap-12"
      >{#each [{ icon: '◇', title: 'Typed from the start.', text: 'Zod schemas become function arguments. Effect keeps failures and service requirements in the type system.' }, { icon: '≋', title: 'A stream stays a stream.', text: 'Text, metadata, and unknown calls flow through. Consume registered tool entries only when you choose.' }, { icon: '⌘', title: 'Your tools. Your control.', text: 'Register and unregister at runtime. Pause the middleware. Observe every call without coupling it to your UI.' }] as feature}<article
          ><span
            class="mb-5 block text-2xl text-feature-icon"
            >{feature.icon}</span
          ><h3
            class="mb-3 text-sm font-normal text-feature-title"
            >{feature.title}</h3
          ><p
            class="text-sm leading-6 text-feature-copy"
            >{feature.text}</p
          ></article
        >{/each}</section
    >
    <section
      class="relative mt-20 border-t border-white/6 py-12 text-center"
      ><div
        class="pointer-events-none absolute inset-0 bg-cta-glow"
        aria-hidden="true"
      ></div><span
        class="font-mono text-meta tracking-wider text-cta-label"
        >THAT’S THE WHOLE IDEA.</span
      ><h2
        class="mt-4 mb-7 text-cta font-normal tracking-tight sm:text-subheading"
        >Give your AI a way to act.</h2
      ><div
        class="relative flex flex-wrap items-center justify-center gap-6"
        ><button
          onclick={() =>
            copy(
              'pnpm add @wingsmc/invoker effect zod',
            )}
          class="flex items-center gap-3 rounded-lg border border-white/8 bg-white/1 px-4 py-3.5 font-mono text-label text-cta-command hover:border-lilac/35"
          ><span class="text-cta-prefix">$</span
          >pnpm add @wingsmc/invoker effect zod<Icon
            name="copy"
            size={14}
          /></button
        ><a
          href={github}
          target="_blank"
          rel="noreferrer"
          class="text-detail text-cta-link hover:text-lilac"
          >Explore on GitHub ↗</a
        ></div
      ></section
    >
  </main>
  <footer
    class="flex items-center justify-between border-t border-white/6 py-7 text-caption text-footer"
    ><a
      href="#top"
      class="flex items-center gap-2 text-lg font-medium tracking-tight text-footer-brand"
      ><Icon size={17} />invoker<span
        class="-ml-2 text-lilac">.</span
      ></a
    ><a
      href={`${github}/blob/main/LICENSE`}
      target="_blank"
      rel="noreferrer"
      class="hover:text-lilac">MIT licensed ↗</a
    ></footer
  >
</div>
<div
  role="status"
  aria-live="polite"
  class={`pointer-events-none fixed bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-lilac/30 bg-toast px-5 py-3 text-sm text-toast-text shadow-lg transition-opacity ${toast ? 'opacity-100' : 'opacity-0'}`}
  >{toast}</div
>
