import {create} from 'zustand'

type StudioState = {
    focusMs: number | null
    setFocus: (ms: number | null) => void 
}

export const useStudioStore = create<StudioState>((set) => ({
    focusMs: null,
    setFocus: (ms) => set({ focusMs: ms }),
}))