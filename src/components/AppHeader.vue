<script setup lang="ts">
import { ref } from "vue";

const helpDialog = ref<HTMLDialogElement>();
</script>

<template>
  <header class="topbar">
    <a class="brand" href="#">
      <span class="brand-mark"><i></i><i></i><i></i></span>LOUD<span>CHECK</span>
    </a>
    <div class="local-badge"><span></span> 100% local analysis</div>
    <button class="help" aria-label="How Loudcheck works" @click="helpDialog?.showModal()">
      ?
    </button>
  </header>

  <dialog ref="helpDialog" class="help-dialog" aria-labelledby="help-title">
    <button class="dialog-close" aria-label="Close help" @click="helpDialog?.close()">×</button>
    <p class="eyebrow">HOW IT WORKS</p>
    <h2 id="help-title">Check before you upload.</h2>
    <p>
      Loudcheck measures your audio on-device using the ITU-R BS.1770 algorithm and the EBU R128
      recommendation. Integrated loudness uses BS.1770's K-weighting and gating; loudness range
      (LRA) follows EBU R128; and true peak is reported in dBTP using the same meter.
    </p>
    <p>
      Choose a streaming service to see its likely playback adjustment, then use Preview to hear
      that adjustment locally.
    </p>
    <p class="dialog-note">
      These are useful mastering references, not a guarantee of every listener's playback settings.
    </p>
    <button class="primary dialog-action" @click="helpDialog?.close()">
      Got it <span>→</span>
    </button>
  </dialog>
</template>
