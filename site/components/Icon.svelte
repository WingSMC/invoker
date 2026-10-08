<script lang="ts">
  let {
    name = 'terminal',
    size = 20,
  }: {
    name?: 'terminal' | 'arrow' | 'copy';
    size?: number;
  } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  aria-hidden="true"
  class="shrink-0"
>
  {#if name === 'terminal'}<path
      d="m5 6 6 6-6 6m9 0h5"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else if name === 'arrow'}<path
      d="M5 12h14m-6-6 6 6-6 6"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else}<rect
      x="8"
      y="8"
      width="12"
      height="12"
      rx="2"
      stroke="currentColor"
      stroke-width="1.5"
    /><path
      d="M16 8V4H4v12h4"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    />{/if}
</svg>
