<script lang="ts">
  import {
    highlight,
    snippets,
  } from '../code.js';
  import Icon from './Icon.svelte';
  let {
    oncopy,
  }: { oncopy: (text: string) => void } =
    $props();
  let selected =
    $state<keyof typeof snippets>('register');
  const tabs = [
    'register',
    'stream',
    'events',
    'mock',
  ] as const;
  const info = {
    register: {
      index: '01',
      title: 'Your function,\nnow a tool.',
      text: 'Document arguments, results, and side effects. Zod validates inputs; results are trusted by default. Opt into result validation with returns.validate: true.',
      file: 'tools.ts',
      label: 'Register',
    },
    stream: {
      index: '02',
      title: 'Plug into\nthe conversation.',
      text: 'Wrap an SDK stream. Registered calls find their handlers; text, metadata, and everything else keep flowing.',
      file: 'stream.ts',
      label: 'Stream',
    },
    events: {
      index: '03',
      title: 'Let your UI\nin on the action.',
      text: 'Observe validation, execution, and results. Update your interface without changing your tool handlers.',
      file: 'events.ts',
      label: 'Observe',
    },
    mock: {
      index: '04',
      title:
        'Test every step.\nWithout an API key.',
      text: "This repository's internal mock scripts a model stream for demos and tests. Try fragmented calls, invalid arguments, and cancellation.",
      file: 'mock.ts',
      label: 'Mock AI',
    },
  };
  function keydown(
    event: KeyboardEvent,
    index: number,
  ) {
    const next =
      event.key === 'ArrowRight'
        ? tabs[(index + 1) % tabs.length]
        : event.key === 'ArrowLeft'
          ? tabs[
              (index - 1 + tabs.length) %
                tabs.length
            ]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs.at(-1)
              : undefined;
    if (next) {
      event.preventDefault();
      selected = next;
      document
        .getElementById(`code-${next}`)
        ?.focus();
    }
  }
</script>

<div
  class="grid gap-7 md:grid-cols-code md:gap-14"
>
  <div class="pt-2 md:pt-7">
    <span
      class="hidden size-9 place-items-center rounded-lg border border-lilac/20 bg-lilac/3 font-mono text-sm text-lilac md:grid"
      >{info[selected].index}</span
    >
    <h3
      class="mb-4 text-title leading-tight font-normal tracking-tight whitespace-pre-line md:mt-6 md:text-subheading"
      >{info[selected].title}</h3
    ><p
      class="max-w-xs text-body leading-8 text-code-copy"
      >{info[selected].text}</p
    >
    <div
      class="my-7 flex flex-wrap gap-4 text-detail text-code-feature md:flex-col md:gap-3"
      >{#each ['Inferred argument types', 'Async validation', 'Typed Effect errors'] as feature}<span
          ><span class="mr-2 text-sage">✓</span
          >{feature}</span
        >{/each}</div
    >
    <a
      href="https://github.com/WingSMC/invoker/blob/main/examples/openai.ts"
      target="_blank"
      rel="noreferrer"
      class="text-detail text-code-link transition-colors hover:text-lilac"
      >See a complete example ↗</a
    >
  </div>
  <div
    class="min-w-0 overflow-hidden rounded-xl border border-white/8 bg-linear-to-br from-white/2 to-transparent shadow-2xl shadow-black/20"
  >
    <div
      class="flex items-center justify-between border-b border-white/6 bg-white/2 px-5"
      ><div
        role="tablist"
        aria-label="Code examples"
        class="flex gap-5 sm:gap-7"
        >{#each tabs as tab, index}<button
            type="button"
            role="tab"
            id={`code-${tab}`}
            aria-selected={selected === tab}
            aria-controls="snippet"
            tabindex={selected === tab ? 0 : -1}
            onkeydown={event =>
              keydown(event, index)}
            onclick={() => {
              selected = tab;
            }}
            class={`border-b py-4 text-label transition-colors ${selected === tab ? 'border-lilac text-lilac' : 'border-transparent text-code-tab hover:text-lilac'}`}
            >{info[tab].label}</button
          >{/each}</div
      ><button
        aria-label="Copy code example"
        onclick={() => oncopy(snippets[selected])}
        class="p-1 text-code-copy-icon hover:text-lilac"
        ><Icon
          name="copy"
          size={15}
        /></button
      ></div
    >
    <div
      class="flex items-center gap-2 px-5 pt-4 font-mono text-caption text-code-filename"
      ><span
        class="rounded-xs bg-lilac/10 px-1 text-tiny text-lilac"
        >TS</span
      >{info[selected].file}<span
        class="ml-auto text-meta text-code-language"
        >TypeScript</span
      ></div
    >
    <div
      id="snippet"
      role="tabpanel"
      aria-labelledby={`code-${selected}`}
      tabindex="0"
      ><pre
        class="min-h-118.75 overflow-auto px-5 pt-4 pb-6 font-mono text-label leading-code text-code-text sm:text-detail"
        ><code
          >{@html highlight(
            snippets[selected],
          )}</code
        ></pre
      ></div
    >
  </div>
</div>
