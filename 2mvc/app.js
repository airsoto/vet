(async () => {
  try {
    const parts = [
      "bundle0a.txt",
      "bundle0b.txt",
      "bundle0c.txt",
      "bundle1.txt",
      "bundle2a.txt",
      "tail00.txt",
      "tail01.txt",
      "tail02_03.txt",
      "tail04_05.txt",
      "tail06_07.txt",
      "tail08_09.txt",
      "tail10_11.txt",
      "tail12_13.txt",
      "tail14.txt"
    ];

    const responses = await Promise.all(
      parts.map(async name => {
        const response = await fetch(name, {
          cache: "no-cache"
        });

        if (!response.ok) {
          throw new Error(`No se pudo cargar ${name}`);
        }

        return (await response.text()).trim();
      })
    );

    const encoded = responses.join("");

    const bytes = Uint8Array.from(
      atob(encoded),
      character => character.charCodeAt(0)
    );

    const moduleUrl = URL.createObjectURL(
      new Blob([bytes], {
        type: "text/javascript"
      })
    );

    try {
      await import(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  } catch (error) {
    console.error("No se pudo iniciar 2MVC", error);

    const toast = document.getElementById("toast");

    if (toast) {
      toast.textContent = "No se pudo iniciar la aplicación";
      toast.classList.add("show");

      setTimeout(() => {
        toast.classList.remove("show");
      }, 5000);
    }
  }
})();


/* =========================================================
   VENTANA DE INFORMACIÓN DEL PROYECTO
   ========================================================= */

function initializeProjectInfoModal() {
  const openButton = document.getElementById("openProjectInfo");
  const closeButton = document.getElementById("closeProjectInfo");
  const modal = document.getElementById("projectInfoModal");
  const dialog = modal?.querySelector(".project-info-dialog");

  if (!openButton || !closeButton || !modal || !dialog) {
    return;
  }

  let previouslyFocusedElement = null;

  function getFocusableElements() {
    return Array.from(
      dialog.querySelectorAll(
        [
          "a[href]",
          "button:not([disabled])",
          "input:not([disabled])",
          "select:not([disabled])",
          "textarea:not([disabled])",
          '[tabindex]:not([tabindex="-1"])'
        ].join(",")
      )
    ).filter(element => {
      return (
        element.offsetWidth > 0 ||
        element.offsetHeight > 0 ||
        element === document.activeElement
      );
    });
  }

  function openProjectInfoModal() {
    previouslyFocusedElement = document.activeElement;

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      closeButton.focus();
    });
  }

  function closeProjectInfoModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    if (
      previouslyFocusedElement &&
      typeof previouslyFocusedElement.focus === "function"
    ) {
      previouslyFocusedElement.focus();
    }
  }

  function handleModalKeydown(event) {
    if (!modal.classList.contains("open")) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeProjectInfoModal();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableElements();

    if (!focusableElements.length) {
      event.preventDefault();
      closeButton.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement =
      focusableElements[focusableElements.length - 1];

    if (
      event.shiftKey &&
      document.activeElement === firstElement
    ) {
      event.preventDefault();
      lastElement.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === lastElement
    ) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  openButton.addEventListener(
    "click",
    openProjectInfoModal
  );

  closeButton.addEventListener(
    "click",
    closeProjectInfoModal
  );

  modal.addEventListener("click", event => {
    if (event.target === modal) {
      closeProjectInfoModal();
    }
  });

  dialog.addEventListener("click", event => {
    event.stopPropagation();
  });

  document.addEventListener(
    "keydown",
    handleModalKeydown
  );
}


/* =========================================================
   INICIALIZACIÓN SEGURA
   ========================================================= */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeProjectInfoModal,
    {
      once: true
    }
  );
} else {
  initializeProjectInfoModal();
}
