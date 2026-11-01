export function downloadJson(data: unknown, filename: string) {
    const text = JSON.stringify(data, null, 2)
    const blob = new Blob([text], {type: 'application/json'})
    const url = URL.createObjectURL(blob)
    
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()

    setTimeout(() => URL.revokeObjectURL(url),0)
}