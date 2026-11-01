import { useState } from "react"
import './tictactoe.css'

type SquareValue = 'x' | 'o' | null
type Line = [number,number,number]

function Square({ value, onSquareClick }: { value?: SquareValue; onSquareClick: () => void }) {

  return (
    <div className="square" onClick={onSquareClick}>{value}</div>
  )
}



export default function Brard() {
  const [xisNext, setXisNext] = useState<boolean>(true)
  const [squares, setSquares] = useState<SquareValue[]>(Array(9).fill(null))

  function handleClick(i: number) {
    if (squares[i] || caclulateWinner(squares)) return 
    const nextSquares = squares.slice()
    if (xisNext) {
      nextSquares[i] = 'x'
    } else {
      nextSquares[i] = 'o'
    }
    setSquares(nextSquares)
    setXisNext(!xisNext)
  }

  const winner = caclulateWinner(squares)
  let status
  if(winner){
    status = '胜者' + winner
  }else{
    status = '下一步：' + (xisNext ? 'x' : 'o') 
  }

  return (
    <>
      <div className="status">{status}</div>
      <div className="board-row">
        <Square value={squares[0]} onSquareClick={() => handleClick(0)} />
        <Square value={squares[1]} onSquareClick={() => handleClick(1)} />
        <Square value={squares[2]} onSquareClick={() => handleClick(2)} />
      </div>
      <div className="board-row">
        <Square value={squares[3]} onSquareClick={() => handleClick(3)} />
        <Square value={squares[4]} onSquareClick={() => handleClick(4)} />
        <Square value={squares[5]} onSquareClick={() => handleClick(5)} />
      </div>
      <div className="board-row">
        <Square value={squares[6]} onSquareClick={() => handleClick(6)} />
        <Square value={squares[7]} onSquareClick={() => handleClick(7)} />
        <Square value={squares[8]} onSquareClick={() => handleClick(8)} />
      </div>
    </>
  )
}

function caclulateWinner(squares: SquareValue[]){
  const lines: Line[] = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ]

  for (const [a, b, c] of lines) {
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return squares[a]
    }
  }
}