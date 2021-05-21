import {
  computed,
  defineComponent,
  ref,

  // Types
  PropType,
} from 'vue'
import { render } from '../../utils/render'
import { useFocusTrap } from '../../hooks/use-focus-trap'

export let FocusTrap = defineComponent({
  name: 'FocusTrap',
  props: {
    as: { type: [Object, String], default: 'div' },
    initialFocus: { type: Object as PropType<HTMLElement | null>, default: null },
  },
  render() {
    let slot = {}
    let propsWeControl = { ref: 'el' }
    let { initialFocus, ...passThroughProps } = this.$props

    return render({
      props: { ...passThroughProps, ...propsWeControl },
      slot,
      attrs: this.$attrs,
      slots: this.$slots,
      name: 'FocusTrap',
    })
  },
  setup(props) {
    let container = ref<HTMLElement | null>(null)

    let focusTrapOptions = computed(() => ({ initialFocus: ref(props.initialFocus) }))
    useFocusTrap(container, FocusTrap.All, focusTrapOptions)

    return { el: container }
  },
})
