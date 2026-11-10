// Foto de perfil: reduz a imagem escolhida no próprio aparelho (quadrado de 256 px, recorte central, JPEG) antes de enviar.
// O servidor só confere o tipo e o tamanho; metadados (como a localização da foto) somem aqui, pois a imagem é redesenhada.
export const AVATAR_PX = 256
export const AVATAR_MAX_BYTES = 60 * 1024

const load = file => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir essa imagem.')) }
  img.src = url
})

/** Devolve uma data URL JPEG com no máximo AVATAR_MAX_BYTES, ou lança com uma frase para o usuário. */
export async function resizeToAvatar(file) {
  if (!file || !/^image\/(jpeg|png|webp|heic|heif|gif)$/i.test(file.type || '')) throw new Error('Escolha uma imagem JPEG, PNG ou WebP.')
  const img = await load(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (!side) throw new Error('Imagem inválida.')
  const c = document.createElement('canvas')
  c.width = c.height = AVATAR_PX
  const g = c.getContext('2d')
  g.fillStyle = '#fff'; g.fillRect(0, 0, AVATAR_PX, AVATAR_PX)
  g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
  for (const q of [0.85, 0.72, 0.6, 0.48, 0.36]) {
    const out = c.toDataURL('image/jpeg', q)
    if (Math.floor((out.length - 23) * 3 / 4) <= AVATAR_MAX_BYTES) return out
  }
  throw new Error('A foto ficou grande demais. Tente outra imagem.')
}
