<div
  class="relative mx-auto h-75 w-full max-w-145 sm:h-95 lg:h-102.5"
>
  <div
    class="absolute -inset-4 bg-router-dots bg-size-router-dots mask-router-field"
    aria-hidden="true"
  ></div>
  <svg
    viewBox="0 0 570 410"
    class="relative h-full w-full overflow-visible"
    role="img"
    aria-labelledby="routing-title"
  >
    <title id="routing-title"
      >invoker routes an AI stream to typed
      functions while text passes through</title
    >
    <defs>
      <linearGradient
        id="route"
        gradientUnits="userSpaceOnUse"
        x1="58"
        y1="205"
        x2="560"
        y2="205"
        ><stop
          stop-color="#8b7cc4"
          stop-opacity=".2"
        /><stop
          offset=".5"
          stop-color="#b5a2f5"
        /><stop
          offset="1"
          stop-color="#88bca8"
          stop-opacity=".5"
        /></linearGradient
      >
      <linearGradient
        id="core"
        x1="0"
        y1="0"
        x2="1"
        y2="1"
        ><stop stop-color="#282033" /><stop
          offset="1"
          stop-color="#111219"
        /></linearGradient
      >
      <filter id="glow"
        ><feGaussianBlur
          stdDeviation="4"
        /></filter
      >
      <path
        id="input-route"
        d="M58 205H210"
      /><path
        id="weather-route"
        d="M348 205h30q20 0 20-20v-58q0-20 20-20h80"
      /><path
        id="docs-route"
        d="M348 205h150"
      /><path
        id="tool-route"
        d="M348 205h30q20 0 20 20v58q0 20 20 20h80"
      /><path
        id="text-route"
        d="M279 258v76q0 22 22 22h197"
      />
    </defs>
    <g
      fill="none"
      stroke="url(#route)"
      stroke-width="1"
      ><use href="#input-route" /><use
        href="#weather-route"
      /><use href="#docs-route" /><use
        href="#tool-route"
      /><use
        href="#text-route"
        stroke-dasharray="3 5"
        opacity=".5"
      /></g
    >
    <g class="motion-reduce:hidden">
      {#each [{ path: 'input-route', begin: '0s', duration: '2s', color: '#c9b4ff' }, { path: 'weather-route', begin: '1.7s', duration: '3.5s', color: '#bca9ee' }, { path: 'docs-route', begin: '3s', duration: '3s', color: '#c0addd' }, { path: 'tool-route', begin: '4.6s', duration: '3.5s', color: '#a4c6b5' }, { path: 'text-route', begin: '1s', duration: '5s', color: '#7b7489' }] as packet}
        <g visibility="hidden">
          <set
            attributeName="visibility"
            to="visible"
            begin={packet.begin}
          />
          <animateMotion
            dur={packet.duration}
            begin={packet.begin}
            repeatCount="indefinite"
            ><mpath
              href={`#${packet.path}`}
            /></animateMotion
          >
          <circle
            r="6"
            fill={packet.color}
            filter="url(#glow)"
            opacity=".6"
          />
          <circle r="2" fill={packet.color} />
        </g>
      {/each}
    </g>
    <rect
      x="18"
      y="183"
      width="82"
      height="44"
      rx="10"
      fill="#14141c"
      stroke="#31303e"
    /><text
      x="59"
      y="210"
      text-anchor="middle"
      fill="#aaa7b5"
      font-size="11"
      class="font-mono">AI stream</text
    >
    <rect
      x="203"
      y="145"
      width="152"
      height="120"
      rx="22"
      fill="none"
      stroke="#a38bcb"
      opacity=".2"
      class="motion-safe:animate-breathe"
    /><rect
      x="211"
      y="153"
      width="136"
      height="104"
      rx="16"
      fill="url(#core)"
      stroke="#77608c"
    />
    <path
      d="m249 179 10 10-10 10m16 0h13"
      fill="none"
      stroke="#c6b4fc"
      stroke-width="1.7"
      stroke-linecap="round"
    /><text
      x="279"
      y="227"
      text-anchor="middle"
      fill="#eee9fc"
      font-size="19"
      class="font-mono"
      letter-spacing="-1">invoker</text
    >
    <g
      fill="#111419"
      stroke="#2e353a"
      ><rect
        x="435"
        y="85"
        width="126"
        height="44"
        rx="10"
      /><rect
        x="435"
        y="183"
        width="126"
        height="44"
        rx="10"
      /><rect
        x="435"
        y="281"
        width="126"
        height="44"
        rx="10"
      /></g
    >
    <g
      font-size="11"
      class="font-mono"
      fill="#b5c2bc"
      ><text
        x="451"
        y="111">get_weather()</text
      ><text
        x="451"
        y="209">search_docs()</text
      ><text
        x="451"
        y="307">your_tool()</text
      ></g
    >
    <g fill="#95c7aa"
      ><circle
        cx="547"
        cy="107"
        r="2.5"
      /><circle
        cx="547"
        cy="205"
        r="2.5"
      /><circle
        cx="547"
        cy="303"
        r="2.5"
      /></g
    >
    <text
      x="338"
      y="377"
      fill="#686d79"
      font-size="9"
      class="font-mono"
      >everything else passes through</text
    ><text
      x="211"
      y="130"
      fill="#8c809f"
      font-size="9"
      class="font-mono"
      letter-spacing="2">VALIDATE → EXECUTE</text
    >
  </svg>
  <p
    class="absolute -bottom-1 w-full text-center font-mono text-caption text-graph-caption"
    ><span
      class="mr-2 inline-block size-1 rounded-full bg-lilac"
    ></span>Tool calls find their way. Text keeps
    moving.</p
  >
</div>
