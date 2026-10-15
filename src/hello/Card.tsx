
export default function Card({ title, text }: { title: string; text: string }) {
    return (
        <div>
            <h2>{title}</h2>
            <p>{text}</p>
        </div>
    )
}