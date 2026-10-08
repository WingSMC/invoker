<script lang="ts">
  import { highlight, providerSnippets } from '../code.js';
  import Icon from './Icon.svelte';
  let { oncopy }: { oncopy: (text: string) => void } = $props();
  let selected = $state<keyof typeof providerSnippets>('openai');
  const tabs = ['openai', 'gemini', 'claude'] as const;
  const info = {
    openai: { label: 'OpenAI / Azure', text: 'Chat Completions and Responses. Arguments are assembled across deltas and dispatched at completion. Results become tool messages or function_call_output items.' },
    gemini: { label: 'Gemini', text: 'GenerateContent streams. Complete functionCall parts run after a STOP completion. Results become functionResponse parts; the declared result schema is included in function declarations.' },
    claude: { label: 'Claude', text: 'Messages streams. Client tool_use blocks run after content_block_stop. Results become tool_result blocks, with is_error set for failures. Server tools and thinking events pass through.' },
  };
  function keydown(event: KeyboardEvent, index: number) {
    const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
      : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
      : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
    if (next) {
      event.preventDefault();
      selected = next;
      document.getElementById(`adapter-${next}`)?.focus();
    }
  }
</script>

<section id="adapters" class="pt-20 sm:pt-26">
  <span class="font-mono text-caption tracking-wider text-section-label">03 / THE ADAPTERS</span>
  <h2 class="mt-4 mb-3 text-section font-normal tracking-tight sm:text-title">One registry. Each provider’s protocol.</h2>
  <p class="mb-8 max-w-3xl text-body leading-8 text-section-copy">Choose an adapter for declarations, stream routing, and result messages. Your application keeps the conversation history and sends the next request. Try all four stream formats in the playground above.</p>
  <div class="grid gap-7 md:grid-cols-code md:gap-14">
    <div class="min-w-0">
      <h3 class="mb-4 text-xl font-normal text-feature-title">{info[selected].label}</h3>
      <p class="text-body leading-8 text-code-copy">{info[selected].text}</p>
      <p class="mt-6 text-sm leading-7 text-feature-copy">The model receives argument docs, side effects, result context, and success/failure semantics. Void tools return <code class="font-mono text-lilac">{'{"success":true}'}</code>. Value-returning tools include <code class="font-mono text-lilac">result</code>.</p>
      <p class="mt-6 text-sm leading-7 text-feature-copy">Keep the complete assistant response, including reasoning, signatures, and tool calls, before adding results. These examples preserve entries with the default <code class="font-mono text-lilac">consume: false</code> and assume all requested tools are registered.</p>
      {#if selected === 'gemini'}
        <p class="mt-6 text-sm leading-7 text-feature-copy">Supports Gemini GenerateContent chunks. Live API and Vertex partial argument streams need separate adapters. Keep multiple candidates in separate conversation branches.</p>
      {/if}
      <a href={`https://github.com/WingSMC/invoker/blob/main/examples/${selected}.ts`} target="_blank" rel="noreferrer" class="mt-6 inline-block text-detail text-code-link hover:text-lilac">See a typed SDK example ↗</a>
    </div>
    <div class="min-w-0 overflow-hidden rounded-xl border border-white/8 bg-linear-to-br from-white/2 to-transparent shadow-2xl shadow-black/20">
      <div class="flex items-center justify-between gap-2 border-b border-white/6 bg-white/2 px-4 sm:px-5">
        <div role="tablist" aria-label="Provider examples" class="flex gap-3 sm:gap-6">
          {#each tabs as tab, index}
            <button type="button" role="tab" id={`adapter-${tab}`} aria-selected={selected === tab} aria-controls="adapter-snippet" tabindex={selected === tab ? 0 : -1} onkeydown={event => keydown(event, index)} onclick={() => { selected = tab; }} class={`border-b py-4 text-label transition-colors ${selected === tab ? 'border-lilac text-lilac' : 'border-transparent text-code-tab hover:text-lilac'}`}>{info[tab].label}</button>
          {/each}
        </div>
        <button aria-label="Copy provider example" onclick={() => oncopy(providerSnippets[selected])} class="shrink-0 p-1 text-code-copy-icon hover:text-lilac"><Icon name="copy" size={15} /></button>
      </div>
      <div id="adapter-snippet" role="tabpanel" aria-labelledby={`adapter-${selected}`} tabindex="0">
        <pre class="max-h-160 overflow-auto px-5 py-6 font-mono text-label leading-code text-code-text sm:text-detail"><code>{@html highlight(providerSnippets[selected])}</code></pre>
      </div>
    </div>
  </div>
</section>
