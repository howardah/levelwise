<script setup lang="ts">
import { formatDb } from "../lib/loudness";

defineProps<{ integrated: number | null; peak: number | null; lra: number | null }>();
</script>

<template>
  <div class="metrics">
    <article>
      <p>INTEGRATED LOUDNESS</p>
      <strong>{{ formatDb(integrated, " LUFS") }}</strong>
      <span>Gated EBU R128 measurement</span>
    </article>
    <article>
      <p>TRUE PEAK</p>
      <strong>{{ formatDb(peak, " dBTP") }}</strong>
      <span>4× oversampled peak scan</span>
    </article>
    <article>
      <p>LOUDNESS RANGE</p>
      <strong>{{ lra?.toFixed(1) ?? "—" }} <b>LU</b></strong>
      <span>EBU Tech 3342 range</span>
    </article>
  </div>
</template>
