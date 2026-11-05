import {create} from 'zustand'
import {persist} from 'zustand/middleware'

type StudioState = {
    focusMs: number | null
    collapsed: boolean
    setFocus: (ms: number | null) => void 
    toggleCollapsed: () => void
}

export const useStudioStore = create<StudioState>()(
    persist(
        (set) => ({
            focusMs: null,
            collapsed: false,
            setFocus: (ms) => set({ focusMs: ms }),
            toggleCollapsed: () => set((s) => ({collapsed: !s.collapsed})),
        }),
        {
            name: 'studio-ui',
            partialize: (s) => ({collapsed: s.collapsed})
        }
    )
    
)