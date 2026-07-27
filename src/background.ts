import OBR from "@owlbear-rodeo/sdk";

import { BackgroundController } from "./background-controller";
import { RELEASE_VERSION } from "./version";

OBR.onReady(() => {
  console.info(`Where Am I background ${RELEASE_VERSION} ready`);
  const controller = new BackgroundController();
  void controller.start().catch((error: unknown) => {
    console.error("Where am I? background failed to start.", error);
  });
  window.addEventListener("pagehide", () => controller.dispose(), {
    once: true,
  });
});
