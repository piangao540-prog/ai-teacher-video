import { useState, useEffect, useRef} from "react"
import styles from './App.module.css'

const lines = [
  { id: 1, code: 'const a = 1' },
  { id: 2, code: 'const b = 2' },
  { id: 3, code: 'console.log((a+b)' },
]


export default function App() {
  const [show, setShow] = useState(true)
  const [n, setN] = useState(0)
  const inp = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.title = `点击了${n}次`
  },[n])
  
  useEffect(() => {
    console.log('组件挂载了')
    return () => { console.log('组件卸载了') }
  },[])

  return (
    <div>
      <ul className={styles.list}>
        {show && lines.map((line,i) => <li className={`${styles.item} ${line.id === 2 ? styles.active : ''}`} key={line.id}>{i+1}.{line.code}</li>)}
      </ul>
      <p>{n}</p>
      <button onClick={() => setN(n+1)}>+1</button>
      <button onClick={() => setShow(!show)}>切换</button>

      <div>
        <input ref={inp} />
        <button onClick={() => inp.current?.focus()}>聚焦</button>
      </div>
    </div>
  )
}