import type { ShopifyAdminPort, ShopifyOwnerRecord } from './types.ts'

export class InMemoryShopifyAdminPort implements ShopifyAdminPort {
  readonly owners: ShopifyOwnerRecord[]

  constructor(owners: ShopifyOwnerRecord[] = []) {
    this.owners = owners.map((owner) => ({ ...owner }))
  }

  async listOwners(input: { type: ShopifyOwnerRecord['type']; handle: string }): Promise<ShopifyOwnerRecord[]> {
    return this.owners
      .filter((owner) => owner.type === input.type && owner.functionHandle === input.handle)
      .map((owner) => ({ ...owner }))
  }

  async createOwner(input: Parameters<ShopifyAdminPort['createOwner']>[0]): Promise<{ id: string }> {
    const id = `gid://shopify/${input.definition.type}/${this.owners.length + 1}`
    this.owners.push({
      id,
      type: input.definition.type,
      functionHandle: input.handle,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.settings as Omit<ShopifyOwnerRecord, 'id' | 'type' | 'functionHandle'>),
      ...(input.definition.type === 'discount' ? { status: 'ACTIVE' } : {}),
      metafieldValue: input.config === undefined ? null : JSON.stringify(input.config),
    })
    return { id }
  }

  async updateOwnerSettings(input: Parameters<ShopifyAdminPort['updateOwnerSettings']>[0]): Promise<void> {
    const owner = this.owners.find((candidate) => candidate.id === input.id)
    if (!owner) throw new Error(`Owner "${input.id}" not found`)
    Object.assign(owner, input.settings)
  }

  async setOwnerConfig(input: Parameters<ShopifyAdminPort['setOwnerConfig']>[0]): Promise<void> {
    const owner = this.owners.find((candidate) => candidate.id === input.id)
    if (!owner) throw new Error(`Owner "${input.id}" not found`)
    owner.metafieldValue = JSON.stringify(input.config)
  }

  async deleteOwner(input: Parameters<ShopifyAdminPort['deleteOwner']>[0]): Promise<void> {
    const index = this.owners.findIndex((candidate) => candidate.id === input.id && candidate.type === input.type)
    if (index === -1) throw new Error(`Owner "${input.id}" not found`)
    this.owners.splice(index, 1)
  }
}
