/**
 * Synchronizes ARIA validity and :user-invalid / fallback styling after interaction,
 * per modern-web-guidance `validate-input-after-interaction`.
 */
export function initFormValidationSync(root: HTMLElement): () => void {
  const supportsUserInvalid =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('selector(:user-invalid)');

  const dirtyState = new WeakMap<
    Element,
    { hasInteracted: boolean; hasBlurred: boolean }
  >();
  const flagged = new WeakSet<Element>();
  const announced = new WeakSet<Element>();

  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.classList.add('visually-hidden');
  document.body.append(announcer);

  let announceTimer: number | undefined;
  let announcedField: Element | undefined;

  const linkError = (el: HTMLElement, shown: boolean) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length > 0) {
      el.setAttribute('aria-describedby', ids.join(' '));
    } else {
      el.removeAttribute('aria-describedby');
    }
  };

  const spokenText = (node: HTMLElement): string => {
    const copy = node.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    copy
      .querySelectorAll('[role="img"][aria-label]')
      .forEach((n) => n.replaceWith(`${n.getAttribute('aria-label')}: `));
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const announceError = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const errorEl = document.getElementById(errorId);
    if (!errorEl) return;
    const labelText = el.labels?.[0] ? `${spokenText(el.labels[0])}: ` : '';
    window.clearTimeout(announceTimer);
    announcer.textContent = '';
    announcedField = el;
    announceTimer = window.setTimeout(() => {
      announcer.textContent = labelText + spokenText(errorEl);
    }, 500);
  };

  const isFieldEl = (
    el: EventTarget | null,
  ): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    el instanceof HTMLElement && el.matches('input, select, textarea');

  const syncAria = (
    el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    announce = false,
  ) => {
    let isInvalid = false;
    if (supportsUserInvalid) {
      isInvalid = el.matches(':user-invalid');
    } else {
      const state = dirtyState.get(el);
      if (state?.hasInteracted && state?.hasBlurred) {
        isInvalid = !el.validity.valid;
        el.classList.toggle('user-invalid-fallback', isInvalid);
        el.classList.toggle('user-valid-fallback', !isInvalid);
      }
    }

    if (isInvalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute('aria-invalid', 'true');
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
      el.setAttribute('aria-invalid', 'false');
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        window.clearTimeout(announceTimer);
        announcer.textContent = '';
      }
    }
  };

  root.querySelectorAll('input, select, textarea').forEach((el) => {
    if (isFieldEl(el)) {
      syncAria(el);
    }
  });

  const handleBlur = (e: FocusEvent) => {
    if (!isFieldEl(e.target)) return;
    if (!supportsUserInvalid) {
      const state = dirtyState.get(e.target) ?? {
        hasInteracted: false,
        hasBlurred: false,
      };
      state.hasBlurred = true;
      dirtyState.set(e.target, state);
    }
    syncAria(e.target, true);
  };

  const handleInput = (e: Event) => {
    if (!isFieldEl(e.target)) return;
    if (!supportsUserInvalid) {
      const state = dirtyState.get(e.target) ?? {
        hasInteracted: false,
        hasBlurred: false,
      };
      state.hasInteracted = true;
      dirtyState.set(e.target, state);
    }
    if (e.target.hasAttribute('aria-invalid')) {
      syncAria(e.target, false);
    }
  };

  const handleChange = (e: Event) => {
    if (!isFieldEl(e.target)) return;
    if (!supportsUserInvalid) {
      dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
    }
    syncAria(e.target, true);
  };

  const handleInvalid = (e: Event) => {
    if (!isFieldEl(e.target)) return;
    if (!supportsUserInvalid) {
      dirtyState.set(e.target, { hasInteracted: true, hasBlurred: true });
    }
    announced.add(e.target);
    syncAria(e.target, false);
  };

  const handleReset = (e: Event) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    window.setTimeout(() => {
      for (const control of Array.from(form.elements)) {
        if (isFieldEl(control)) {
          dirtyState.delete(control);
          control.classList.remove('user-invalid-fallback', 'user-valid-fallback');
          flagged.delete(control);
          announced.delete(control);
          control.setAttribute('aria-invalid', 'false');
          linkError(control, false);
        }
      }
    });
  };

  root.addEventListener('blur', handleBlur, true);
  root.addEventListener('input', handleInput);
  root.addEventListener('change', handleChange, true);
  root.addEventListener('invalid', handleInvalid, true);
  root.addEventListener('reset', handleReset, true);

  return () => {
    window.clearTimeout(announceTimer);
    root.removeEventListener('blur', handleBlur, true);
    root.removeEventListener('input', handleInput);
    root.removeEventListener('change', handleChange, true);
    root.removeEventListener('invalid', handleInvalid, true);
    root.removeEventListener('reset', handleReset, true);
    announcer.remove();
  };
}

/**
 * Fallback for browsers without <dialog closedby="any"> support (e.g. Safari),
 * testing pointer coordinates outside dialog bounding box on pointerdown + pointerup.
 */
export function attachDialogLightDismissFallback(
  dialog: HTMLDialogElement,
  enabled: boolean,
): () => void {
  if (!enabled || 'closedBy' in HTMLDialogElement.prototype) {
    return () => {};
  }

  let pressedOutside = false;
  const isOutside = (e: PointerEvent) => {
    const r = dialog.getBoundingClientRect();
    return (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    );
  };

  const onPointerDown = (e: PointerEvent) => {
    pressedOutside = isOutside(e);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (pressedOutside && isOutside(e)) {
      dialog.close();
    }
    pressedOutside = false;
  };

  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointerup', onPointerUp);

  return () => {
    dialog.removeEventListener('pointerdown', onPointerDown);
    dialog.removeEventListener('pointerup', onPointerUp);
  };
}
