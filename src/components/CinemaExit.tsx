import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  visible: boolean
  onExit: () => void
}

/**
 * 演示模式唯一的可见出口。
 * 演示模式会藏掉顶栏和输入区，没有它用户只能靠键盘 f 键退出，
 * 于是就「卡」在只剩预览的画面里出不来。
 */
export function CinemaExit({ visible, onExit }: Props) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key="cinema-exit"
          type="button"
          onClick={onExit}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          aria-label="退出演示模式（Esc）"
          title="退出演示模式（Esc）"
          className="glass fixed right-3 top-3 z-50 flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[12px] text-fog opacity-70 transition-opacity hover:text-chalk hover:opacity-100 focus-visible:opacity-100 md:right-4 md:top-4"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2.5 2.5l7 7m0-7l-7 7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <span>退出演示</span>
          <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] text-fog-dim sm:inline">
            Esc
          </kbd>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
