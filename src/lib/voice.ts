import { PRODUCTS } from './constants'
import type { MovementType } from '../types'

export interface VoiceResult {
  type?: MovementType
  productId?: string
  quantity?: number
  note?: string
}

const vietnameseNumbers: Record<string, number> = {
  'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'tư': 4, 'năm': 5,
  'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9, 'mười': 10,
}

function normalize(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function parseVoiceCommand(transcript: string): VoiceResult {
  const text = normalize(transcript)
  let type: MovementType | undefined
  if (text.includes('nhap kho') || text.startsWith('nhap ')) type = 'inbound'
  else if (text.includes('xuat ban') || text.includes('ban ')) type = 'sale_out'
  else if (text.includes('che bien') || text.includes('rang ')) type = 'processing_out'
  else if (text.includes('hao hut') || text.includes('huy ')) type = 'waste'
  else if (text.includes('kiem ke') || text.includes('ton thuc te')) type = 'count'

  const product = PRODUCTS.find((item) => {
    const name = normalize(item.name)
    return text.includes(name) ||
      (item.id.includes('chestnut') && text.includes('hat de')) ||
      (item.id.includes('potato') && text.includes('khoai')) ||
      (item.id.includes('cake') && text.includes('banh'))
  })

  const digit = text.match(/(\d+(?:[.,]\d+)?)/)
  let quantity = digit ? Number(digit[1].replace(',', '.')) : undefined
  if (quantity === undefined) {
    const entry = Object.entries(vietnameseNumbers).find(([word]) => text.includes(word))
    quantity = entry?.[1]
  }
  return { type, productId: product?.id, quantity, note: `Nhập bằng giọng nói: ${transcript}` }
}

export function startVoiceRecognition(onResult: (text: string) => void, onError: (text: string) => void) {
  const SpeechRecognition = (
    window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
  ).SpeechRecognition || (
    window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  ).webkitSpeechRecognition

  if (!SpeechRecognition) {
    onError('Trình duyệt này chưa hỗ trợ nhập giọng nói. Hãy thử Chrome trên Android.')
    return
  }
  const recognition = new SpeechRecognition()
  recognition.lang = 'vi-VN'
  recognition.interimResults = false
  recognition.continuous = false
  recognition.onresult = (event) => onResult(event.results[0][0].transcript)
  recognition.onerror = () => onError('Không nghe rõ. Vui lòng thử lại.')
  recognition.start()
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void
  onerror: () => void
  start: () => void
}
