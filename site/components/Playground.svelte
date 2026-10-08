<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { highlight } from '../code.js';
  import type {
    DemoUpdate,
    Scenario,
    Stage,
  } from '../demo.js';
  import { DemoSession } from '../demo.js';
  import Icon from './Icon.svelte';

  const city = 'Berlin, DE';
  let protocol = $state<
    'chat-completions' | 'responses' | 'gemini' | 'claude'
  >('chat-completions');
  let registered = $state(true);
  let consume = $state(false);
  let paused = $state(false);
  let scenario = $state<Scenario>('weather');
  let running = $state(false);
  let stage = $state<Stage>('idle');
  let status = $state('Ready to invoke');
  let prompt = $state('');
  let answer = $state('');
  let incoming = $state(0);
  let forwarded = $state(0);
  let eventCount = $state(0);
  let selectedLog = $state<
    'event' | 'incoming' | 'forwarded'
  >('event');
  let logs = $state<
    {
      id: number;
      category: string;
      label: string;
      data: unknown;
      time: number;
    }[]
  >([]);
  let outputs = $state<
    { name: string; value: unknown }[]
  >([]);
  let bypassed = $state(false);
  let logId = 0;
  let started = 0;
  let controller: AbortController | undefined;
  let session: DemoSession;
  const scenarios: {
    id: Scenario;
    label: string;
    prompt: string;
  }[] = [
    {
      id: 'weather',
      label: 'Weather',
      prompt: 'What’s the weather in',
    },
    {
      id: 'invalid',
      label: 'Invalid args',
      prompt:
        'Try a weather call with invalid arguments for',
    },
    {
      id: 'unknown',
      label: 'Unknown tool',
      prompt:
        'Try an unregistered search tool for',
    },
    {
      id: 'failure',
      label: 'Handler fails',
      prompt: 'Try a failing weather handler for',
    },
    {
      id: 'parallel',
      label: 'Two calls',
      prompt: 'Check the weather in Tokyo and',
    },
    {
      id: 'truncated',
      label: 'Truncated',
      prompt: 'Try a truncated weather call for',
    },
  ];
  const steps = [
    {
      id: 'stream',
      title: 'Receive the stream',
      detail: 'Collect fragmented tool arguments',
      icon: '≋',
    },
    {
      id: 'validate',
      title: 'Validate with Zod',
      detail: 'JSON → checked, typed arguments',
      icon: '◇',
    },
    {
      id: 'execute',
      title: 'Run your function',
      detail:
        'Effects, promises, or plain returns',
      icon: '⌘',
    },
    {
      id: 'success',
      title: 'Emit the result',
      detail: 'Your UI knows what happened',
      icon: '↗',
    },
  ];
  const logTabs = [
    { id: 'event', label: 'Lifecycle events' },
    { id: 'incoming', label: 'Incoming stream' },
    {
      id: 'forwarded',
      label: 'Forwarded stream',
    },
  ] as const;
  let stageIndex = $derived(
    steps.findIndex(step => step.id === stage),
  );
  let visibleLogs = $derived(
    logs.filter(
      entry => entry.category === selectedLog,
    ),
  );
  let outputCode = $derived(
    outputs.length === 1
      ? JSON.stringify(outputs[0]?.value, null, 2)
      : JSON.stringify(outputs, null, 2),
  );

  onMount(() => {
    session = new DemoSession(update);
  });
  onDestroy(() => controller?.abort());

  function update(event: DemoUpdate): void {
    if (event.type === 'stage' && event.stage) {
      stage = event.stage;
      status = event.label;
    }
    if (event.type === 'chunk') {
      if (event.label === 'incoming') incoming++;
      else forwarded++;
      appendLog(
        event.label,
        chunkLabel(event.data),
        event.data,
      );
    }
    if (event.type === 'event') {
      eventCount++;
      appendLog('event', event.label, event.data);
    }
    if (event.type === 'result')
      outputs.push({
        name: event.label,
        value: event.data,
      });
    if (event.type === 'text')
      answer += String(event.data);
  }

  function appendLog(
    category: string,
    label: string,
    data: unknown,
  ): void {
    logs.push({
      id: ++logId,
      category,
      label,
      data,
      time: performance.now() - started,
    });
    if (logs.length > 500) logs.shift();
  }

  function chunkLabel(value: unknown): string {
    const event = value as {
      type?: string;
      choices?: {
        delta?: {
          tool_calls?: unknown[];
          content?: string;
        };
        finish_reason?: string | null;
      }[];
      usage?: unknown;
      candidates?: { finishReason?: string; content?: { parts?: { functionCall?: unknown }[] } }[];
      usageMetadata?: unknown;
    };
    return (
      event.type ??
      (event.candidates
        ? (event.candidates[0]?.finishReason ??
          (event.candidates[0]?.content?.parts?.some(part => part.functionCall)
            ? 'functionCall'
            : event.usageMetadata ? 'usage' : 'content.parts'))
        : undefined) ??
      (event.usage
        ? 'usage'
        : (event.choices?.[0]?.finish_reason ??
          (event.choices?.[0]?.delta?.tool_calls
            ? 'delta.tool_calls'
            : 'delta.content')))
    );
  }

  async function run(
    event: SubmitEvent,
  ): Promise<void> {
    event.preventDefault();
    if (running) return;
    controller = new AbortController();
    const signal = controller.signal;
    running = true;
    stage = 'idle';
    status = 'Starting session';
    started = performance.now();
    incoming = 0;
    forwarded = 0;
    eventCount = 0;
    logs = [];
    outputs = [];
    answer = '';
    bypassed = false;
    prompt = `${scenarios.find(item => item.id === scenario)?.prompt} ${city}?`;
    try {
      const summary = await session.run({
        scenario,
        city,
        protocol,
        signal,
      });
      bypassed = summary.outcomes.length === 0;
    } catch (error) {
      stage = 'idle';
      status = signal.aborted
        ? 'Session stopped'
        : 'Session error';
      if (!answer)
        answer = signal.aborted
          ? 'Session stopped. Start another whenever you’re ready.'
          : 'The stream encountered an error. You can try again.';
      if (!signal.aborted)
        appendLog(
          'event',
          'onStreamError',
          String(error),
        );
    } finally {
      running = false;
      controller = undefined;
    }
  }

  function pause(): void {
    paused = !paused;
    session.setPaused(paused);
    if (!running)
      status = paused
        ? 'Middleware paused'
        : 'Ready to invoke';
  }
  function selectLog(
    event: KeyboardEvent,
    index: number,
  ): void {
    const next =
      event.key === 'ArrowRight'
        ? logTabs[(index + 1) % logTabs.length]
        : event.key === 'ArrowLeft'
          ? logTabs[
              (index - 1 + logTabs.length) %
                logTabs.length
            ]
          : undefined;
    if (next) {
      event.preventDefault();
      selectedLog = next.id;
      document
        .getElementById(`log-tab-${next.id}`)
        ?.focus();
    }
  }
</script>

<div
  class="overflow-hidden rounded-xl border border-white/9 bg-linear-to-br from-white/3 to-white/1 shadow-playground backdrop-blur-sm"
>
  <div
    class="flex h-12 items-center gap-4 border-b border-white/6 bg-white/2 px-5"
  >
    <div
      class="flex gap-1.5"
      aria-hidden="true"
      >{#each [1, 2, 3] as dot (dot)}<span
          class="size-1.5 rounded-full border border-window-dot"
        ></span>{/each}</div
    >
    <span
      class="font-mono text-label text-window-title"
      >invoker / live session</span
    >
    <span
      class="ml-auto flex items-center gap-2 text-label text-session-status"
      ><span
        class={`size-1.5 rounded-full bg-sage ${running ? 'motion-safe:animate-pulse' : ''}`}
      ></span><span data-testid="session-status"
        >{status}</span
      ></span
    >
  </div>
  <div
    class="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-white/6 px-5 py-4"
  >
    <label
      class="flex items-center gap-2 text-label text-protocol-label"
      >Protocol<select
        aria-label="Mock AI protocol"
        bind:value={protocol}
        disabled={running}
        class="max-w-40 rounded border border-lilac/20 bg-protocol-surface px-2 py-1.5 text-label text-protocol-text"
        ><option value="chat-completions"
          >Chat Completions</option
        ><option value="responses"
          >Responses API</option
        ><option value="gemini">Gemini</option
        ><option value="claude">Claude</option
        ></select
      ></label
    >
    <label
      class="flex cursor-pointer items-center gap-2 text-label text-control-label"
      ><input
        type="checkbox"
        bind:checked={registered}
        onchange={() =>
          session.setRegistered(registered)}
        class="peer sr-only"
      /><span
        class="relative h-3.5 w-6 rounded-full border border-switch-border bg-switch-track after:absolute after:top-0.5 after:left-0.5 after:size-2 after:rounded-full after:bg-switch-thumb after:transition-transform peer-checked:border-lilac peer-checked:bg-lilac peer-checked:after:translate-x-2.5 peer-checked:after:bg-switch-active-thumb peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-lilac"
      ></span>Tool registered</label
    >
    <label
      class="flex cursor-pointer items-center gap-2 text-label text-control-label"
      ><input
        type="checkbox"
        bind:checked={consume}
        onchange={() =>
          session.setConsume(consume)}
        disabled={running}
        class="peer sr-only"
      /><span
        class="relative h-3.5 w-6 rounded-full border border-switch-border bg-switch-track after:absolute after:top-0.5 after:left-0.5 after:size-2 after:rounded-full after:bg-switch-thumb after:transition-transform peer-checked:border-lilac peer-checked:bg-lilac peer-checked:after:translate-x-2.5 peer-checked:after:bg-switch-active-thumb peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-lilac peer-disabled:opacity-40"
      ></span>Consume calls</label
    >
    <button
      onclick={pause}
      aria-pressed={paused}
      class={`rounded border px-2.5 py-1.5 text-label sm:ml-auto ${paused ? 'border-amber-300/25 bg-amber-200/5 text-amber-200/80' : 'border-white/10 text-pause-label'}`}
      ><span class="mr-1.5"
        >{paused ? '▷' : 'Ⅱ'}</span
      >{paused
        ? 'Resume middleware'
        : 'Pause middleware'}</button
    >
  </div>
  <div class="grid md:grid-cols-demo">
    <div
      class="flex flex-col border-b border-white/6 p-5 md:border-r md:border-b-0 md:p-6"
    >
      <div
        class="flex items-center gap-2 font-mono text-caption tracking-wider text-panel-title"
        ><span class="text-base text-lilac"
          >✧</span
        >THE CONVERSATION<span
          class="ml-auto rounded border border-white/6 bg-white/2 px-1.5 py-0.5 text-tiny tracking-wide text-mock-badge"
          >MOCK AI</span
        ></div
      >
      <div
        class="mt-6 h-56.25 overflow-auto pr-1 sm:h-62.5"
        aria-label="Demo conversation"
        role="log"
        aria-live="polite"
      >
        {#if prompt}
          <div class="mb-6 flex gap-3"
            ><span
              class="grid size-7 shrink-0 place-items-center rounded-lg border border-sage/20 bg-sage/3 font-mono text-label text-sage"
              >Y</span
            ><div
              ><span
                class="mb-2 block text-label text-chat-role"
                >You</span
              ><p
                class="text-body leading-7 wrap-anywhere text-chat-prompt"
                >{prompt}</p
              ></div
            ></div
          >
          <div class="flex gap-3"
            ><span
              class="grid size-7 shrink-0 place-items-center rounded-lg border border-lilac/25 bg-lilac/5 text-lilac"
              ><Icon size={16} /></span
            ><div
              ><span
                class="mb-2 block text-label text-chat-role"
                >Assistant</span
              ><p
                data-testid="answer"
                class="text-body leading-7 wrap-anywhere text-chat-answer"
                >{answer}</p
              >{#if running && !answer}<span
                  class="inline-flex gap-1 py-3"
                  aria-label="Assistant is working"
                  >{#each [0, 1, 2] as item}<span
                      class="size-1 rounded-full bg-lilac/70 motion-safe:animate-pulse"
                      style={`animation-delay:${item * 200}ms`}
                    ></span>{/each}</span
                >{/if}</div
            ></div
          >
        {:else}
          <div class="flex gap-3"
            ><span
              class="grid size-7 shrink-0 place-items-center rounded-lg border border-lilac/25 bg-lilac/5 text-lilac"
              ><Icon size={16} /></span
            ><div
              ><span
                class="mb-2 block text-label text-chat-role"
                >Assistant</span
              ><p
                class="text-body leading-7 text-chat-answer"
                >I can check the weather. Run a
                scenario to see how invoker turns a
                tool call into a result.</p
              ></div
            ></div
          >
          <div
            class="mt-9 flex flex-col items-center gap-4 text-center text-label text-chat-hint"
            ><span
              class="grid size-7 place-items-center rounded-full border border-lilac/15"
              aria-hidden="true"
              ><span
                class="size-4 rounded-full border border-dashed border-lilac/25 motion-safe:animate-spin"
              ></span></span
            >A little request. A lot happening
            underneath.</div
          >
        {/if}
      </div>
      <form
        onsubmit={run}
        class="mt-5 flex items-center rounded-lg border border-lilac/20 bg-input-surface p-1.5 focus-within:border-lilac/60"
        ><label
          for="city"
          class="sr-only"
          >City for the weather tool</label
        ><input
          id="city"
          value={city}
          readonly
          autocomplete="off"
          class="min-w-0 grow bg-transparent px-3 py-2 text-sm text-input-text outline-none"
        /><button
          type="submit"
          aria-label="Run demo"
          hidden={running}
          class="grid size-8 shrink-0 place-items-center rounded bg-lilac text-input-action-ink transition-colors hover:bg-input-action-hover"
          ><Icon
            name="arrow"
            size={18}
          /></button
        ><button
          type="button"
          aria-label="Stop demo"
          hidden={!running}
          onclick={() => controller?.abort()}
          class="grid size-8 shrink-0 place-items-center rounded bg-stop-action text-sm text-input-action-ink"
          >■</button
        ></form
      >
      <div
        role="group"
        aria-label="Demo scenario"
        class="mt-3 flex flex-wrap gap-1.5"
        >{#each scenarios as item}<button
            onclick={() => {
              scenario = item.id;
            }}
            disabled={running}
            aria-pressed={scenario === item.id}
            class={`rounded border px-2 py-1 text-caption transition-colors ${scenario === item.id ? 'border-lilac/30 bg-lilac/5 text-scenario-active' : 'border-white/6 text-scenario-label hover:text-lilac'}`}
            >{item.label}</button
          >{/each}</div
      >
    </div>
    <div class="p-5 md:p-6">
      <div
        class="flex items-center gap-2 font-mono text-caption tracking-wider text-panel-title"
        ><span class="text-base text-lilac"
          >⌘</span
        >UNDER THE HOOD<span
          class="ml-auto text-tiny text-live-label"
          >LIVE</span
        ></div
      >
      <div
        class="my-4 grid gap-1 sm:grid-cols-2 md:grid-cols-1"
      >
        {#each steps as step, index}
          {@const completed =
            index < stageIndex ||
            stage === 'success'}
          {@const current =
            index === stageIndex &&
            stage !== 'success'}
          <div
            class="relative flex items-center gap-3 py-2"
          >
            <span
              class={`grid size-7 shrink-0 place-items-center rounded-lg border text-lg transition-colors ${completed ? 'border-sage/30 bg-sage/5 text-sage' : current ? 'border-lilac/60 bg-lilac/15 text-lilac shadow-step' : stage === 'fail' && index === 3 ? 'border-rose-300/30 bg-rose-300/5 text-rose-300' : 'border-step-border bg-step-surface text-step-icon'}`}
              >{step.icon}</span
            >
            <div
              ><strong
                class="mb-1 block text-detail font-normal text-step-title"
                >{step.title}</strong
              ><small
                class="text-caption text-step-detail"
                >{step.detail}</small
              ></div
            ><span
              class="ml-auto hidden font-mono text-meta text-step-status md:inline"
              >{stage === 'bypass'
                ? 'bypassed'
                : stage === 'fail' && index === 3
                  ? 'contained'
                  : completed
                    ? 'done'
                    : current
                      ? 'running'
                      : 'waiting'}</span
            >
          </div>
        {/each}
      </div>
      <div
        class={`overflow-hidden rounded-lg border bg-black/20 transition-colors ${outputs.length ? 'border-sage/25' : 'border-white/6'}`}
        ><div
          class="flex items-center gap-2 border-b border-white/5 px-3 py-2.5 font-mono text-meta text-output-label"
          ><span
            class={`size-1 rounded-full ${outputs.length ? 'bg-sage' : 'bg-output-dot'}`}
          ></span>TOOL OUTPUT<span
            class="ml-auto text-output-status"
            >{outputs.length
              ? 'result received'
              : bypassed
                ? 'bypassed'
                : 'awaiting call'}</span
          ></div
        ><pre
          data-testid="tool-output"
          class="max-h-40 min-h-22 overflow-auto px-3 py-3 font-mono text-label leading-5 text-output-text"
          ><code
            >{#if outputs.length}{@html highlight(
                outputCode,
              )}{:else}<span
                class="text-output-placeholder"
                >{bypassed
                  ? '// No handler ran. Call passed through.'
                  : '// Your function’s result appears here.'}</span
              >{/if}</code
          ></pre
        ></div
      >
      <div
        class="mt-4 flex items-baseline justify-between gap-2"
        >{#each [{ label: 'chunks in', value: incoming, id: 'incoming' }, { label: 'passed through', value: forwarded, id: 'forwarded' }, { label: 'lifecycle events', value: eventCount, id: 'events' }] as stat}<div
            class="flex items-baseline gap-2"
            ><strong
              data-testid={`${stat.id}-count`}
              class="font-mono text-base font-normal text-counter"
              >{String(stat.value).padStart(
                2,
                '0',
              )}</strong
            ><span
              class="text-meta text-counter-label"
              >{stat.label}</span
            ></div
          >{/each}</div
      >
    </div>
  </div>
  <div
    class="border-t border-white/6 bg-black/10"
  >
    <div
      class="flex items-center justify-between gap-2 border-b border-white/5 px-4 sm:px-5"
      ><div
        role="tablist"
        aria-label="Stream inspector"
        class="flex gap-3 sm:gap-5"
        >{#each logTabs as tab, index}<button
            role="tab"
            id={`log-tab-${tab.id}`}
            aria-selected={selectedLog === tab.id}
            aria-controls="stream-log"
            tabindex={selectedLog === tab.id
              ? 0
              : -1}
            onclick={() => {
              selectedLog = tab.id;
            }}
            onkeydown={event =>
              selectLog(event, index)}
            class={`border-b py-3.5 text-meta sm:text-caption ${selectedLog === tab.id ? 'border-lilac text-lilac' : 'border-transparent text-inspector-label'}`}
            >{tab.label}{#if tab.id === 'event'}<span
                class="ml-1 rounded bg-lilac/10 px-1 font-mono text-meta"
                >{eventCount}</span
              >{/if}</button
          >{/each}</div
      ><button
        onclick={() => {
          logs = [];
        }}
        class="text-caption text-inspector-label hover:text-lilac"
        >Clear</button
      ></div
    >
    <div
      id="stream-log"
      role="tabpanel"
      aria-labelledby={`log-tab-${selectedLog}`}
      tabindex="0"
      class="h-38.75 overflow-auto px-4 py-2 sm:px-5"
    >
      {#if !visibleLogs.length}<p
          class="mt-5 font-mono text-caption text-inspector-placeholder"
          ><span class="mr-3 text-lilac">›</span
          >{selectedLog === 'event'
            ? 'Listening. Run a demo to see the lifecycle unfold.'
            : 'Stream entries will appear here.'}</p
        >{/if}
      {#each visibleLogs as entry (entry.id)}<details
          class="border-b border-white/3 font-mono text-caption"
          ><summary
            class="flex cursor-pointer list-none items-center gap-3 py-2"
            ><span
              class="w-12 shrink-0 text-meta text-inspector-time"
              >+{(entry.time / 1000).toFixed(
                2,
              )}s</span
            ><span
              class={entry.label.includes('Fail')
                ? 'text-rose-300'
                : 'text-lilac'}>◇</span
            ><span
              class="shrink-0 text-inspector-event"
              >{entry.label}</span
            ><span
              class="hidden truncate text-inspector-preview sm:inline"
              >{JSON.stringify(entry.data).slice(
                0,
                85,
              )}</span
            ><span
              class="ml-auto text-inspector-expand"
              >+</span
            ></summary
          ><pre
            class="mb-4 overflow-auto text-caption leading-5 sm:ml-18"
            ><code
              >{@html highlight(
                JSON.stringify(
                  entry.data,
                  null,
                  2,
                ),
              )}</code
            ></pre
          ></details
        >{/each}
    </div>
  </div>
</div>
