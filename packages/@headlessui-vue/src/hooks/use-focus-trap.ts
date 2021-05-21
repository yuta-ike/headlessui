import {
  computed,
  onMounted,
  ref,
  watch,

  // Types
  Ref,
} from 'vue'

import { Keys } from '../keyboard'
import { focusElement, focusIn, Focus, FocusResult } from '../utils/focus-management'
import { useWindowEvent } from '../hooks/use-window-event'

export enum Features {
  /** No features enabled for the `useFocusTrap` hook. */
  None = 1 << 0,

  /** Ensure that we move focus initially into the container. */
  InitialFocus = 1 << 1,

  /** Ensure that pressing `Tab` and `Shift+Tab` is trapped within the container. */
  TabLock = 1 << 2,

  /** Ensure that programmatically moving focus outside of the container is disallowed. */
  FocusLock = 1 << 3,

  /** Ensure that we restore the focus when unmounting the component that uses this `useFocusTrap` hook. */
  RestoreFocus = 1 << 4,

  /** Enable all features. */
  All = InitialFocus | TabLock | FocusLock | RestoreFocus,
}

export function useFocusTrap(
  container: Ref<HTMLElement | null>,
  features: Ref<Features> = ref(Features.All),
  options: Ref<{
    initialFocus?: Ref<HTMLElement | null>
    containers?: Ref<Set<Ref<HTMLElement | null>>>
  }> = ref({})
) {
  let restoreElement = ref<HTMLElement | null>(
    typeof window !== 'undefined' ? (document.activeElement as HTMLElement) : null
  )
  let previousActiveElement = ref<HTMLElement | null>(null)

  let featuresRestoreFocus = computed(() => Boolean(features.value & Features.RestoreFocus))
  let featuresInitialFocus = computed(() => Boolean(features.value & Features.InitialFocus))

  // Deliberately not using a ref, we don't want to trigger re-renders.
  let mounted = { value: false }

  onMounted(() => {
    // Capture the currently focused element, before we enable the focus trap.
    watch(
      [featuresRestoreFocus],
      (newValues, prevValues) => {
        if (newValues.every((value, idx) => prevValues[idx] === value)) return

        if (!featuresRestoreFocus.value) return

        mounted.value = true
        restoreElement.value = document.activeElement as HTMLElement
      },
      { immediate: true }
    )

    // Restore the focus when we unmount the component.
    watch(
      [featuresRestoreFocus],
      (newValues, prevValues, onInvalidate) => {
        if (newValues.every((value, idx) => prevValues[idx] === value)) return

        if (!featuresRestoreFocus.value) return

        onInvalidate(() => {
          if (mounted.value === false) return

          mounted.value = false
          focusElement(restoreElement.value)
          restoreElement.value = null
        })
      },
      { immediate: true }
    )

    // Handle initial focus
    watch(
      [container, options, options.value.initialFocus, featuresInitialFocus],
      (newValues, prevValues) => {
        if (newValues.every((value, idx) => prevValues[idx] === value)) return

        if (!featuresInitialFocus.value) return
        if (!container.value) return

        let activeElement = document.activeElement as HTMLElement

        if (options.value.initialFocus?.value) {
          if (options.value.initialFocus?.value === activeElement) {
            previousActiveElement.value = activeElement
            return // Initial focus ref is already the active element
          }
        } else if (container.value.contains(activeElement)) {
          previousActiveElement.value = activeElement
          return // Already focused within Dialog
        }

        // Try to focus the initialFocus ref
        if (options.value.initialFocus?.value) {
          focusElement(options.value.initialFocus.value)
        } else {
          if (focusIn(container.value, Focus.First) === FocusResult.Error) {
            throw new Error('There are no focusable elements inside the <FocusTrap />')
          }
        }

        previousActiveElement.value = document.activeElement as HTMLElement
      },
      { immediate: true }
    )
  })

  // Handle Tab & Shift+Tab keyboard events
  useWindowEvent('keydown', event => {
    if (!(features.value & Features.TabLock)) return

    if (!container.value) return
    if (event.key !== Keys.Tab) return

    event.preventDefault()

    if (
      focusIn(
        container.value,
        (event.shiftKey ? Focus.Previous : Focus.Next) | Focus.WrapAround
      ) === FocusResult.Success
    ) {
      previousActiveElement.value = document.activeElement as HTMLElement
    }
  })

  // Prevent programmatically escaping
  useWindowEvent(
    'focus',
    event => {
      if (!(features.value & Features.FocusLock)) return

      let allContainers = new Set(options.value.containers?.value)
      allContainers.add(container)

      if (!allContainers.size) return

      let previous = previousActiveElement.value
      if (!previous) return
      if (!mounted.value) return

      let toElement = event.target as HTMLElement | null

      if (toElement && toElement instanceof HTMLElement) {
        if (!contains(allContainers, toElement)) {
          event.preventDefault()
          event.stopPropagation()
          focusElement(previous)
        } else {
          previousActiveElement.value = toElement
          focusElement(toElement)
        }
      } else {
        focusElement(previousActiveElement.value)
      }
    },
    true
  )
}

function contains(containers: Set<Ref<HTMLElement | null>>, element: HTMLElement) {
  for (let container of containers) {
    if (container.value?.contains(element)) return true
  }

  return false
}
