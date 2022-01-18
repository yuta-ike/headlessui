import {
  defineComponent,
  ref,
  provide,
  inject,
  onMounted,
  onUnmounted,
  computed,
  nextTick,
  InjectionKey,
  Ref,
  ComputedRef,
  watchEffect,
  toRaw,
  watch,
} from 'vue'

import { Features, render, omit } from '../../utils/render'
import { useId } from '../../hooks/use-id'
import { Keys } from '../../keyboard'
import { calculateActiveIndex, Focus } from '../../utils/calculate-active-index'
import { dom } from '../../utils/dom'
import { useWindowEvent } from '../../hooks/use-window-event'
import { useOpenClosed, State, useOpenClosedProvider } from '../../internal/open-closed'
import { match } from '../../utils/match'
import { useResolveButtonType } from '../../hooks/use-resolve-button-type'

enum ComboboxStates {
  Open,
  Closed,
}

function nextFrame(cb: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(cb))
}

type ComboboxOptionDataRef = Ref<{ disabled: boolean; value: unknown }>
type StateDefinition = {
  // State
  ComboboxState: Ref<ComboboxStates>
  value: ComputedRef<unknown>
  orientation: Ref<'vertical' | 'horizontal'>

  labelRef: Ref<HTMLLabelElement | null>
  inputRef: Ref<HTMLInputElement | null>
  buttonRef: Ref<HTMLButtonElement | null>
  optionsRef: Ref<HTMLDivElement | null>

  disabled: Ref<boolean>
  options: Ref<{ id: string; dataRef: ComboboxOptionDataRef }[]>
  searchQuery: Ref<string>
  activeOptionIndex: Ref<number | null>

  // State mutators
  closeCombobox(): void
  openCombobox(): void
  goToOption(focus: Focus, id?: string): void
  selectOption(id: string): void
  selectActiveOption(): void
  registerOption(id: string, dataRef: ComboboxOptionDataRef): void
  unregisterOption(id: string): void
  select(value: unknown): void
}

let ComboboxContext = Symbol('ComboboxContext') as InjectionKey<StateDefinition>

function useComboboxContext(component: string) {
  let context = inject(ComboboxContext, null)

  if (context === null) {
    let err = new Error(`<${component} /> is missing a parent <Combobox /> component.`)
    if (Error.captureStackTrace) Error.captureStackTrace(err, useComboboxContext)
    throw err
  }

  return context
}

// ---

export let Combobox = defineComponent({
  name: 'Combobox',
  emits: { 'update:modelValue': (_value: any) => true, search: (_value: string) => true },
  props: {
    as: { type: [Object, String], default: 'template' },
    disabled: { type: [Boolean], default: false },
    horizontal: { type: [Boolean], default: false },
    modelValue: { type: [Object, String, Number, Boolean] },
  },
  setup(props, { slots, attrs, emit }) {
    let ComboboxState = ref<StateDefinition['ComboboxState']['value']>(ComboboxStates.Closed)
    let labelRef = ref<StateDefinition['labelRef']['value']>(null)
    let inputRef = ref<StateDefinition['inputRef']['value']>(null)
    let buttonRef = ref<StateDefinition['buttonRef']['value']>(null)
    let optionsRef = ref<StateDefinition['optionsRef']['value']>(null)
    let options = ref<StateDefinition['options']['value']>([])
    let searchQuery = ref<StateDefinition['searchQuery']['value']>('')
    let activeOptionIndex = ref<StateDefinition['activeOptionIndex']['value']>(null)

    let value = computed(() => props.modelValue)

    let api = {
      ComboboxState,
      value,
      orientation: computed(() => (props.horizontal ? 'horizontal' : 'vertical')),
      labelRef,
      buttonRef,
      optionsRef,
      disabled: computed(() => props.disabled),
      options,
      searchQuery,
      activeOptionIndex,
      closeCombobox() {
        if (props.disabled) return
        if (ComboboxState.value === ComboboxStates.Closed) return
        ComboboxState.value = ComboboxStates.Closed
        activeOptionIndex.value = null
      },
      openCombobox() {
        if (props.disabled) return
        if (ComboboxState.value === ComboboxStates.Open) return
        ComboboxState.value = ComboboxStates.Open
      },
      goToOption(focus: Focus, id?: string) {
        if (props.disabled) return
        if (ComboboxState.value === ComboboxStates.Closed) return

        let nextActiveOptionIndex = calculateActiveIndex(
          focus === Focus.Specific
            ? { focus: Focus.Specific, id: id! }
            : { focus: focus as Exclude<Focus, Focus.Specific> },
          {
            resolveItems: () => options.value,
            resolveActiveIndex: () => activeOptionIndex.value,
            resolveId: option => option.id,
            resolveDisabled: option => option.dataRef.disabled,
          }
        )

        if (searchQuery.value === '' && activeOptionIndex.value === nextActiveOptionIndex) return
        searchQuery.value = ''
        activeOptionIndex.value = nextActiveOptionIndex
      },
      selectOption(id: string) {
        let option = options.value.find(item => item.id === id)
        if (!option) return

        let { dataRef } = option
        emit('update:modelValue', dataRef.value)

        // TODO: Do we need this?
        if (typeof dataRef.value === 'string' && inputRef.value) {
          inputRef.value.value = dataRef.value
        }
      },
      selectActiveOption() {
        if (activeOptionIndex.value === null) return

        let { dataRef } = options.value[activeOptionIndex.value]
        emit('update:modelValue', dataRef.value)

        // TODO: Do we need this?
        if (typeof dataRef.value === 'string' && inputRef.value) {
          inputRef.value.value = dataRef.value
        }
      },
      registerOption(id: string, dataRef: ComboboxOptionDataRef) {
        let orderMap = Array.from(
          optionsRef.value?.querySelectorAll('[id^="headlessui-combobox-option-"]') ?? []
        ).reduce(
          (lookup, element, index) => Object.assign(lookup, { [element.id]: index }),
          {}
        ) as Record<string, number>

        // @ts-expect-error The expected type comes from property 'dataRef' which is declared here on type '{ id: string; dataRef: { textValue: string; disabled: boolean; }; }'
        options.value = [...options.value, { id, dataRef }].sort(
          (a, z) => orderMap[a.id] - orderMap[z.id]
        )
      },
      unregisterOption(id: string) {
        let nextOptions = options.value.slice()
        let currentActiveOption =
          activeOptionIndex.value !== null ? nextOptions[activeOptionIndex.value] : null
        let idx = nextOptions.findIndex(a => a.id === id)
        if (idx !== -1) nextOptions.splice(idx, 1)
        options.value = nextOptions
        activeOptionIndex.value = (() => {
          if (idx === activeOptionIndex.value) return null
          if (currentActiveOption === null) return null

          // If we removed the option before the actual active index, then it would be out of sync. To
          // fix this, we will find the correct (new) index position.
          return nextOptions.indexOf(currentActiveOption)
        })()
      },
      select(value: unknown) {
        if (props.disabled) return
        emit('update:modelValue', value)
      },
    }

    useWindowEvent('mousedown', event => {
      let target = event.target as HTMLElement
      let active = document.activeElement

      if (ComboboxState.value !== ComboboxStates.Open) return

      if (dom(inputRef)?.contains(target)) return
      if (dom(buttonRef)?.contains(target)) return
      if (dom(optionsRef)?.contains(target)) return

      api.closeCombobox()

      if (active !== document.body && active?.contains(target)) return // Keep focus on newly clicked/focused element
      if (!event.defaultPrevented) dom(inputRef)?.focus({ preventScroll: true })
    })

    // @ts-expect-error Types of property 'dataRef' are incompatible.
    provide(ComboboxContext, api)
    useOpenClosedProvider(
      computed(() =>
        match(ComboboxState.value, {
          [ComboboxStates.Open]: State.Open,
          [ComboboxStates.Closed]: State.Closed,
        })
      )
    )

    return () => {
      let slot = { open: ComboboxState.value === ComboboxStates.Open, disabled: props.disabled }
      return render({
        props: omit(props, ['modelValue', 'onUpdate:modelValue', 'disabled', 'horizontal']),
        slot,
        slots,
        attrs,
        name: 'Combobox',
      })
    }
  },
})

// ---

export let ComboboxLabel = defineComponent({
  name: 'ComboboxLabel',
  props: { as: { type: [Object, String], default: 'label' } },
  render() {
    let api = useComboboxContext('ComboboxLabel')

    let slot = {
      open: api.ComboboxState.value === ComboboxStates.Open,
      disabled: api.disabled.value,
    }
    let propsWeControl = { id: this.id, ref: 'el', onClick: this.handleClick }

    return render({
      props: { ...this.$props, ...propsWeControl },
      slot,
      attrs: this.$attrs,
      slots: this.$slots,
      name: 'ComboboxLabel',
    })
  },
  setup() {
    let api = useComboboxContext('ComboboxLabel')
    let id = `headlessui-combobox-label-${useId()}`

    return {
      id,
      el: api.labelRef,
      handleClick() {
        dom(api.inputRef)?.focus({ preventScroll: true })
      },
    }
  },
})

// ---

export let ComboboxButton = defineComponent({
  name: 'ComboboxButton',
  props: {
    as: { type: [Object, String], default: 'button' },
  },
  render() {
    let api = useComboboxContext('ComboboxButton')

    let slot = {
      open: api.ComboboxState.value === ComboboxStates.Open,
      disabled: api.disabled.value,
    }
    let propsWeControl = {
      ref: 'el',
      id: this.id,
      type: this.type,
      tabindex: '-1',
      'aria-haspopup': true,
      'aria-controls': dom(api.optionsRef)?.id,
      'aria-expanded': api.disabled.value
        ? undefined
        : api.ComboboxState.value === ComboboxStates.Open,
      'aria-labelledby': api.labelRef.value
        ? [dom(api.labelRef)?.id, this.id].join(' ')
        : undefined,
      disabled: api.disabled.value === true ? true : undefined,
      onKeyup: this.handleKeyUp,
      onClick: this.handleClick,
    }

    return render({
      props: { ...this.$props, ...propsWeControl },
      slot,
      attrs: this.$attrs,
      slots: this.$slots,
      name: 'ComboboxButton',
    })
  },
  setup(props, { attrs }) {
    let api = useComboboxContext('ComboboxButton')
    let id = `headlessui-combobox-button-${useId()}`

    function handleClick(event: MouseEvent) {
      if (api.disabled.value) return
      if (api.ComboboxState.value === ComboboxStates.Open) {
        api.closeCombobox()
      } else {
        event.preventDefault()
        api.openCombobox()
      }

      nextTick(() => dom(api.inputRef)?.focus({ preventScroll: true }))
    }

    return {
      id,
      el: api.buttonRef,
      type: useResolveButtonType(
        computed(() => ({ as: props.as, type: attrs.type })),
        api.buttonRef
      ),
      handleClick,
    }
  },
})

// ---

export let ComboboxInput = defineComponent({
  name: 'ComboboxInput',
  props: {
    as: { type: [Object, String], default: 'ul' },
    static: { type: Boolean, default: false },
    unmount: { type: Boolean, default: true },
  },
  render() {
    let api = useComboboxContext('ComboboxInput')

    let slot = { open: api.ComboboxState.value === ComboboxStates.Open }
    let propsWeControl = {
      'aria-activedescendant':
        api.activeOptionIndex.value === null
          ? undefined
          : api.options.value[api.activeOptionIndex.value]?.id,
      'aria-labelledby': dom(api.labelRef)?.id ?? dom(api.buttonRef)?.id,
      'aria-orientation': api.orientation.value,
      id: this.id,
      onKeydown: this.handleKeyDown,
      role: 'combobox',
      tabIndex: 0,
      ref: 'el',
    }
    let passThroughProps = this.$props

    return render({
      props: { ...passThroughProps, ...propsWeControl },
      slot,
      attrs: this.$attrs,
      slots: this.$slots,
      features: Features.RenderStrategy | Features.Static,
      visible: this.visible,
      name: 'ComboboxInput',
    })
  },
  setup() {
    let api = useComboboxContext('ComboboxInput')
    let id = `headlessui-combobox-options-${useId()}`
    let searchDebounce = ref<ReturnType<typeof setTimeout> | null>(null)

    function handleKeyDown(event: KeyboardEvent) {
      if (searchDebounce.value) clearTimeout(searchDebounce.value)

      switch (event.key) {
        // Ref: https://www.w3.org/TR/wai-aria-practices-1.2/#keyboard-interaction-12

        case Keys.Space:
        case Keys.Enter:
          event.preventDefault()
          event.stopPropagation()
          api.selectActiveOption()
          api.closeCombobox()
          nextTick(() => dom(api.inputRef)?.focus({ preventScroll: true }))
          break

        case match(api.orientation.value, {
          vertical: Keys.ArrowDown,
          horizontal: Keys.ArrowRight,
        }):
          event.preventDefault()
          event.stopPropagation()
          return match(api.ComboboxState.value, {
            [ComboboxStates.Open]: () => api.goToOption(Focus.Next),
            [ComboboxStates.Closed]: () => {
              api.openCombobox()
              nextTick(() => {
                if (!api.value) {
                  api.goToOption(Focus.First)
                }
              })
            },
          })

        case match(api.orientation.value, { vertical: Keys.ArrowUp, horizontal: Keys.ArrowLeft }):
          event.preventDefault()
          event.stopPropagation()
          return match(api.ComboboxState.value, {
            [ComboboxStates.Open]: () => api.goToOption(Focus.Previous),
            [ComboboxStates.Closed]: () => {
              api.openCombobox()
              nextTick(() => {
                if (!api.value) {
                  api.goToOption(Focus.Last)
                }
              })
            },
          })

        case Keys.Home:
        case Keys.PageUp:
          event.preventDefault()
          event.stopPropagation()
          return api.goToOption(Focus.First)

        case Keys.End:
        case Keys.PageDown:
          event.preventDefault()
          event.stopPropagation()
          return api.goToOption(Focus.Last)

        case Keys.Escape:
          event.preventDefault()
          event.stopPropagation()
          api.closeCombobox()
          nextTick(() => dom(api.inputRef)?.focus({ preventScroll: true }))
          break

        case Keys.Tab:
          event.preventDefault()
          event.stopPropagation()
          api.selectActiveOption()
          api.closeCombobox()
          break
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      api.openCombobox()

      // TODO: How do we do this here?
      // emit('search', (event.target as HTMLInputElement).value)
    }

    let usesOpenClosedState = useOpenClosed()
    let visible = computed(() => {
      if (usesOpenClosedState !== null) {
        return usesOpenClosedState.value === State.Open
      }

      return api.ComboboxState.value === ComboboxStates.Open
    })

    return { id, el: api.optionsRef, handleKeyDown, visible }
  },
})

// ---

export let ComboboxOptions = defineComponent({
  name: 'ComboboxOptions',
  props: {
    as: { type: [Object, String], default: 'ul' },
    static: { type: Boolean, default: false },
    unmount: { type: Boolean, default: true },
  },
  render() {
    let api = useComboboxContext('ComboboxOptions')

    let slot = { open: api.ComboboxState.value === ComboboxStates.Open }
    let propsWeControl = {
      'aria-activedescendant':
        api.activeOptionIndex.value === null
          ? undefined
          : api.options.value[api.activeOptionIndex.value]?.id,
      'aria-labelledby': dom(api.labelRef)?.id ?? dom(api.buttonRef)?.id,
      'aria-orientation': api.orientation.value,
      id: this.id,
      ref: 'el',
    }
    let passThroughProps = this.$props

    return render({
      props: { ...passThroughProps, ...propsWeControl },
      slot,
      attrs: this.$attrs,
      slots: this.$slots,
      features: Features.RenderStrategy | Features.Static,
      visible: this.visible,
      name: 'ComboboxOptions',
    })
  },
  setup() {
    let api = useComboboxContext('ComboboxOptions')
    let id = `headlessui-combobox-options-${useId()}`

    let usesOpenClosedState = useOpenClosed()
    let visible = computed(() => {
      if (usesOpenClosedState !== null) {
        return usesOpenClosedState.value === State.Open
      }

      return api.ComboboxState.value === ComboboxStates.Open
    })

    return { id, el: api.optionsRef, visible }
  },
})

export let ComboboxOption = defineComponent({
  name: 'ComboboxOption',
  props: {
    as: { type: [Object, String], default: 'li' },
    value: { type: [Object, String, Number, Boolean] },
    disabled: { type: Boolean, default: false },
  },
  setup(props, { slots, attrs }) {
    let api = useComboboxContext('ComboboxOption')
    let id = `headlessui-combobox-option-${useId()}`

    let active = computed(() => {
      return api.activeOptionIndex.value !== null
        ? api.options.value[api.activeOptionIndex.value].id === id
        : false
    })

    let selected = computed(() => toRaw(api.value.value) === toRaw(props.value))

    let dataRef = ref<ComboboxOptionDataRef['value']>({
      disabled: props.disabled,
      value: props.value,
    })

    onMounted(() => api.registerOption(id, dataRef))
    onUnmounted(() => api.unregisterOption(id))

    onMounted(() => {
      watch(
        [api.ComboboxState, selected],
        () => {
          if (api.ComboboxState.value !== ComboboxStates.Open) return
          if (!selected.value) return
          api.goToOption(Focus.Specific, id)
        },
        { immediate: true }
      )
    })

    watchEffect(() => {
      if (api.ComboboxState.value !== ComboboxStates.Open) return
      if (!active.value) return
      nextTick(() => document.getElementById(id)?.scrollIntoView?.({ block: 'nearest' }))
    })

    function handleClick(event: MouseEvent) {
      if (props.disabled) return event.preventDefault()
      api.select(props.value)
      api.closeCombobox()
      nextTick(() => dom(api.inputRef)?.focus({ preventScroll: true }))
    }

    function handleFocus() {
      if (props.disabled) return api.goToOption(Focus.Nothing)
      api.goToOption(Focus.Specific, id)
    }

    function handleMove() {
      if (props.disabled) return
      if (active.value) return
      api.goToOption(Focus.Specific, id)
    }

    function handleLeave() {
      if (props.disabled) return
      if (!active.value) return
      api.goToOption(Focus.Nothing)
    }

    return () => {
      let { disabled } = props
      let slot = { active: active.value, selected: selected.value, disabled }
      let propsWeControl = {
        id,
        role: 'option',
        tabIndex: disabled === true ? undefined : -1,
        'aria-disabled': disabled === true ? true : undefined,
        'aria-selected': selected.value === true ? selected.value : undefined,
        disabled: undefined, // Never forward the `disabled` prop
        onClick: handleClick,
        onFocus: handleFocus,
        onPointermove: handleMove,
        onMousemove: handleMove,
        onPointerleave: handleLeave,
        onMouseleave: handleLeave,
      }

      return render({
        props: { ...props, ...propsWeControl },
        slot,
        attrs,
        slots,
        name: 'ComboboxOption',
      })
    }
  },
})
