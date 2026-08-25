import type { ShopifyClient } from '../../shopify/client.ts'
import type { AnyFunctionDefinition, ShopifyFunctionType } from '../../types.ts'
import type { ShopifyAdminPort, ShopifyOwnerRecord } from './types.ts'

export const FUNCTION_METAFIELD_NAMESPACE = '$app:openshop'

interface ShopifyUserError {
  field?: string[] | string | null
  message: string
}

export class ShopifyAdminUserError extends Error {
  readonly userErrors: ShopifyUserError[]

  constructor(userErrors: ShopifyUserError[]) {
    super(userErrors.map((error) => error.message).join(', '))
    this.name = 'ShopifyAdminUserError'
    this.userErrors = userErrors
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function connection(data: unknown, key: string): Record<string, unknown>[] {
  return array(record(record(data)[key]).nodes)
}

function metafieldValue(node: Record<string, unknown>): string | null {
  const value = record(node.metafield).value
  return typeof value === 'string' ? value : null
}

function userErrors(data: unknown, key: string): ShopifyUserError[] {
  return array(record(record(data)[key]).userErrors)
    .filter((error): error is Record<string, unknown> & { message: string } => typeof error.message === 'string')
    .map((error) => ({
      message: error.message,
      ...(typeof error.field === 'string' || Array.isArray(error.field) || error.field === null
        ? { field: error.field as string | string[] | null }
        : {}),
    }))
}

function assertNoUserErrors(data: unknown, key: string): Record<string, unknown> {
  const errors = userErrors(data, key)
  if (errors.length) throw new ShopifyAdminUserError(errors)
  return record(record(data)[key])
}

function metafields(handle: string, config: Record<string, unknown> | undefined) {
  return config === undefined
    ? []
    : [{
        namespace: FUNCTION_METAFIELD_NAMESPACE,
        key: handle,
        type: 'json',
        value: JSON.stringify(config),
      }]
}

function titleSettings(settings: Record<string, unknown>) {
  return {
    title: settings.title,
    enabled: settings.enabled,
  }
}

function discountInput(settings: Record<string, unknown>, handle?: string, config?: Record<string, unknown>) {
  return {
    ...(handle ? { functionHandle: handle } : {}),
    title: settings.title,
    startsAt: settings.startsAt,
    endsAt: settings.endsAt,
    combinesWith: settings.combinesWith,
    ...(settings.mode === 'code'
      ? { code: settings.code, usageLimit: settings.usageLimit }
      : {}),
    ...(handle ? { metafields: metafields(handle, config) } : {}),
  }
}

export class ShopifyGraphqlAdminAdapter implements ShopifyAdminPort {
  private readonly client: ShopifyClient

  constructor(client: ShopifyClient) {
    this.client = client
  }

  async listOwners(input: { type: ShopifyFunctionType; handle: string }): Promise<ShopifyOwnerRecord[]> {
    switch (input.type) {
      case 'discount': return this.listDiscounts(input.handle)
      case 'cart-transform': return this.listCartTransforms(input.handle)
      case 'delivery-customization': return this.listTitledOwners(input.type, input.handle, 'deliveryCustomizations')
      case 'payment-customization': return this.listTitledOwners(input.type, input.handle, 'paymentCustomizations')
      case 'checkout-validation': return this.listValidations(input.handle)
      case 'fulfillment-constraints': return this.listFulfillmentConstraints(input.handle)
    }
  }

  async createOwner(input: Parameters<ShopifyAdminPort['createOwner']>[0]): Promise<{ id: string }> {
    const ownerMetafields = metafields(input.handle, input.config)
    let query: string
    let variables: Record<string, unknown>
    let mutationKey: string
    let resourceKey: string

    switch (input.definition.type) {
      case 'discount': {
        const code = input.mode === 'code'
        mutationKey = code ? 'discountCodeAppCreate' : 'discountAutomaticAppCreate'
        resourceKey = code ? 'codeAppDiscount' : 'automaticAppDiscount'
        const argument = code ? 'codeAppDiscount' : 'automaticAppDiscount'
        const inputType = code ? 'DiscountCodeAppInput' : 'DiscountAutomaticAppInput'
        query = `#graphql
          mutation CreateFunctionDiscount($input: ${inputType}!) {
            ${mutationKey}(${argument}: $input) {
              ${resourceKey} { discountId }
              userErrors { field message }
            }
          }`
        variables = { input: discountInput(input.settings, input.handle, input.config) }
        break
      }
      case 'cart-transform':
        mutationKey = 'cartTransformCreate'
        resourceKey = 'cartTransform'
        query = `#graphql
          mutation CreateCartTransform($functionHandle: String!, $blockOnFailure: Boolean, $metafields: [MetafieldInput!]) {
            cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: $blockOnFailure, metafields: $metafields) {
              cartTransform { id }
              userErrors { field message }
            }
          }`
        variables = {
          functionHandle: input.handle,
          blockOnFailure: input.settings.blockOnFailure,
          metafields: ownerMetafields,
        }
        break
      case 'fulfillment-constraints':
        mutationKey = 'fulfillmentConstraintRuleCreate'
        resourceKey = 'fulfillmentConstraintRule'
        query = `#graphql
          mutation CreateFulfillmentConstraint($functionHandle: String!, $deliveryMethodTypes: [DeliveryMethodType!]!, $metafields: [MetafieldInput!]) {
            fulfillmentConstraintRuleCreate(functionHandle: $functionHandle, deliveryMethodTypes: $deliveryMethodTypes, metafields: $metafields) {
              fulfillmentConstraintRule { id }
              userErrors { field message }
            }
          }`
        variables = {
          functionHandle: input.handle,
          deliveryMethodTypes: input.settings.deliveryMethodTypes,
          metafields: ownerMetafields,
        }
        break
      case 'delivery-customization':
      case 'payment-customization': {
        const delivery = input.definition.type === 'delivery-customization'
        mutationKey = delivery ? 'deliveryCustomizationCreate' : 'paymentCustomizationCreate'
        resourceKey = delivery ? 'deliveryCustomization' : 'paymentCustomization'
        const inputType = delivery ? 'DeliveryCustomizationInput' : 'PaymentCustomizationInput'
        const argument = delivery ? 'deliveryCustomization' : 'paymentCustomization'
        query = `#graphql
          mutation CreateTitledFunctionOwner($input: ${inputType}!) {
            ${mutationKey}(${argument}: $input) {
              ${resourceKey} { id }
              userErrors { field message }
            }
          }`
        variables = { input: { functionHandle: input.handle, ...titleSettings(input.settings), metafields: ownerMetafields } }
        break
      }
      case 'checkout-validation':
        mutationKey = 'validationCreate'
        resourceKey = 'validation'
        query = `#graphql
          mutation CreateValidation($input: ValidationCreateInput!) {
            validationCreate(validation: $input) {
              validation { id }
              userErrors { field message }
            }
          }`
        variables = {
          input: {
            functionHandle: input.handle,
            title: input.settings.title,
            enable: input.settings.enabled,
            blockOnFailure: input.settings.blockOnFailure,
            metafields: ownerMetafields,
          },
        }
        break
    }

    const data = await this.client.graphql(query, { variables })
    const payload = assertNoUserErrors(data, mutationKey)
    const resource = record(payload[resourceKey])
    const id = typeof resource.id === 'string' ? resource.id : resource.discountId
    if (typeof id !== 'string') throw new Error(`Shopify mutation ${mutationKey} returned no owner id`)
    return { id }
  }

  async updateOwnerSettings(input: Parameters<ShopifyAdminPort['updateOwnerSettings']>[0]): Promise<void> {
    let query: string
    let variables: Record<string, unknown>
    let mutationKey: string

    switch (input.definition.type) {
      case 'discount': {
        const code = input.mode === 'code'
        mutationKey = code ? 'discountCodeAppUpdate' : 'discountAutomaticAppUpdate'
        const argument = code ? 'codeAppDiscount' : 'automaticAppDiscount'
        const inputType = code ? 'DiscountCodeAppInput' : 'DiscountAutomaticAppInput'
        query = `#graphql
          mutation UpdateFunctionDiscount($id: ID!, $input: ${inputType}!) {
            ${mutationKey}(id: $id, ${argument}: $input) { userErrors { field message } }
          }`
        variables = { id: input.id, input: discountInput(input.settings) }
        break
      }
      case 'cart-transform':
        throw new Error('Cart Transform settings cannot be updated by Shopify')
      case 'fulfillment-constraints':
        mutationKey = 'fulfillmentConstraintRuleUpdate'
        query = `#graphql
          mutation UpdateFulfillmentConstraint($id: ID!, $deliveryMethodTypes: [DeliveryMethodType!]!) {
            fulfillmentConstraintRuleUpdate(id: $id, deliveryMethodTypes: $deliveryMethodTypes) {
              fulfillmentConstraintRule { id }
              userErrors { field message }
            }
          }`
        variables = { id: input.id, deliveryMethodTypes: input.settings.deliveryMethodTypes }
        break
      case 'delivery-customization':
      case 'payment-customization': {
        const delivery = input.definition.type === 'delivery-customization'
        mutationKey = delivery ? 'deliveryCustomizationUpdate' : 'paymentCustomizationUpdate'
        const inputType = delivery ? 'DeliveryCustomizationInput' : 'PaymentCustomizationInput'
        const argument = delivery ? 'deliveryCustomization' : 'paymentCustomization'
        query = `#graphql
          mutation UpdateTitledFunctionOwner($id: ID!, $input: ${inputType}!) {
            ${mutationKey}(id: $id, ${argument}: $input) { userErrors { field message } }
          }`
        variables = { id: input.id, input: titleSettings(input.settings) }
        break
      }
      case 'checkout-validation':
        mutationKey = 'validationUpdate'
        query = `#graphql
          mutation UpdateValidation($id: ID!, $input: ValidationUpdateInput!) {
            validationUpdate(id: $id, validation: $input) { userErrors { field message } }
          }`
        variables = {
          id: input.id,
          input: {
            title: input.settings.title,
            enable: input.settings.enabled,
            blockOnFailure: input.settings.blockOnFailure,
          },
        }
        break
    }

    const data = await this.client.graphql(query, { variables })
    assertNoUserErrors(data, mutationKey)
  }

  async setOwnerConfig(input: Parameters<ShopifyAdminPort['setOwnerConfig']>[0]): Promise<void> {
    const query = `#graphql
      mutation SetFunctionOwnerConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`
    const variables = {
      metafields: [{
        ownerId: input.id,
        namespace: FUNCTION_METAFIELD_NAMESPACE,
        key: input.handle,
        type: 'json',
        value: JSON.stringify(input.config),
      }],
    }
    const data = await this.client.graphql(query, { variables })
    assertNoUserErrors(data, 'metafieldsSet')
  }

  async deleteOwner(input: Parameters<ShopifyAdminPort['deleteOwner']>[0]): Promise<void> {
    const mutationKey = input.type === 'discount'
      ? input.mode === 'code' ? 'discountCodeDelete' : 'discountAutomaticDelete'
      : ({
          'cart-transform': 'cartTransformDelete',
          'delivery-customization': 'deliveryCustomizationDelete',
          'payment-customization': 'paymentCustomizationDelete',
          'checkout-validation': 'validationDelete',
          'fulfillment-constraints': 'fulfillmentConstraintRuleDelete',
        } satisfies Record<Exclude<ShopifyFunctionType, 'discount'>, string>)[input.type]
    const query = `#graphql
      mutation DeleteFunctionOwner($id: ID!) {
        ${mutationKey}(id: $id) { userErrors { field message } }
      }`
    const data = await this.client.graphql(query, { variables: { id: input.id } })
    assertNoUserErrors(data, mutationKey)
  }

  private async listDiscounts(handle: string): Promise<ShopifyOwnerRecord[]> {
    const query = `#graphql
      query ListDiscountOwners($query: String!, $metafieldKey: String!) {
        shopifyFunctions(first: 100) { nodes { id handle } }
        discountNodes(first: 50, query: $query) {
          nodes {
            id
            discount {
              __typename
              ... on DiscountAutomaticApp {
                appDiscountType { functionId }
                title status startsAt endsAt
                combinesWith { productDiscounts orderDiscounts shippingDiscounts }
              }
              ... on DiscountCodeApp {
                appDiscountType { functionId }
                title status startsAt endsAt usageLimit
                combinesWith { productDiscounts orderDiscounts shippingDiscounts }
                codes(first: 1) { nodes { code } }
              }
            }
            metafield(namespace: "${FUNCTION_METAFIELD_NAMESPACE}", key: $metafieldKey) { value }
          }
        }
      }`
    const data = await this.client.graphql(query, {
      variables: { query: `function_handle:${handle}`, metafieldKey: handle },
    })
    const handles = new Map(connection(data, 'shopifyFunctions').map((fn) => [fn.id, fn.handle]))
    return connection(data, 'discountNodes')
      .filter((node) => handles.get(record(record(node.discount).appDiscountType).functionId) === handle)
      .map((node) => {
        const discount = record(node.discount)
        const codeNodes = connection(discount, 'codes')
        return {
          id: String(node.id),
          type: 'discount',
          functionHandle: handle,
          mode: discount.__typename === 'DiscountCodeApp' ? 'code' : 'automatic',
          title: typeof discount.title === 'string' ? discount.title : undefined,
          status: typeof discount.status === 'string' ? discount.status : undefined,
          startsAt: typeof discount.startsAt === 'string' ? discount.startsAt : null,
          endsAt: typeof discount.endsAt === 'string' ? discount.endsAt : null,
          usageLimit: typeof discount.usageLimit === 'number' ? discount.usageLimit : null,
          code: typeof codeNodes[0]?.code === 'string' ? codeNodes[0].code : null,
          combinesWith: record(discount.combinesWith) as Record<string, boolean>,
          metafieldValue: metafieldValue(node),
        }
      })
  }

  private async listCartTransforms(handle: string): Promise<ShopifyOwnerRecord[]> {
    const query = `#graphql
      query ListCartTransformOwners($metafieldKey: String!) {
        shopifyFunctions(first: 100) { nodes { id handle } }
        cartTransforms(first: 50) {
          nodes {
            id functionId blockOnFailure
            metafield(namespace: "${FUNCTION_METAFIELD_NAMESPACE}", key: $metafieldKey) { value }
          }
        }
      }`
    const data = await this.client.graphql(query, { variables: { metafieldKey: handle } })
    const handles = new Map(connection(data, 'shopifyFunctions').map((fn) => [fn.id, fn.handle]))
    return connection(data, 'cartTransforms')
      .filter((node) => handles.get(node.functionId) === handle)
      .map((node) => ({
        id: String(node.id),
        type: 'cart-transform',
        functionHandle: handle,
        blockOnFailure: node.blockOnFailure === true,
        metafieldValue: metafieldValue(node),
      }))
  }

  private async listTitledOwners(
    type: 'delivery-customization' | 'payment-customization',
    handle: string,
    connectionKey: 'deliveryCustomizations' | 'paymentCustomizations',
  ): Promise<ShopifyOwnerRecord[]> {
    const query = `#graphql
      query ListTitledFunctionOwners($metafieldKey: String!) {
        ${connectionKey}(first: 50) {
          nodes {
            id title enabled
            shopifyFunction { handle }
            metafield(namespace: "${FUNCTION_METAFIELD_NAMESPACE}", key: $metafieldKey) { value }
          }
        }
      }`
    const data = await this.client.graphql(query, { variables: { metafieldKey: handle } })
    return connection(data, connectionKey)
      .filter((node) => record(node.shopifyFunction).handle === handle)
      .map((node) => ({
        id: String(node.id),
        type,
        functionHandle: handle,
        title: typeof node.title === 'string' ? node.title : undefined,
        enabled: typeof node.enabled === 'boolean' ? node.enabled : undefined,
        metafieldValue: metafieldValue(node),
      }))
  }

  private async listValidations(handle: string): Promise<ShopifyOwnerRecord[]> {
    const query = `#graphql
      query ListValidationOwners($metafieldKey: String!) {
        validations(first: 50) {
          nodes {
            id title enabled blockOnFailure
            shopifyFunction { handle }
            metafield(namespace: "${FUNCTION_METAFIELD_NAMESPACE}", key: $metafieldKey) { value }
          }
        }
      }`
    const data = await this.client.graphql(query, { variables: { metafieldKey: handle } })
    return connection(data, 'validations')
      .filter((node) => record(node.shopifyFunction).handle === handle)
      .map((node) => ({
        id: String(node.id),
        type: 'checkout-validation',
        functionHandle: handle,
        title: typeof node.title === 'string' ? node.title : undefined,
        enabled: typeof node.enabled === 'boolean' ? node.enabled : undefined,
        blockOnFailure: node.blockOnFailure === true,
        metafieldValue: metafieldValue(node),
      }))
  }

  private async listFulfillmentConstraints(handle: string): Promise<ShopifyOwnerRecord[]> {
    const query = `#graphql
      query ListFulfillmentConstraintOwners($metafieldKey: String!) {
        fulfillmentConstraintRules {
          id deliveryMethodTypes
          function { handle }
          metafield(namespace: "${FUNCTION_METAFIELD_NAMESPACE}", key: $metafieldKey) { value }
        }
      }`
    const data = await this.client.graphql(query, { variables: { metafieldKey: handle } })
    return array(record(data).fulfillmentConstraintRules)
      .filter((node) => record(node.function).handle === handle)
      .map((node) => ({
        id: String(node.id),
        type: 'fulfillment-constraints',
        functionHandle: handle,
        deliveryMethodTypes: Array.isArray(node.deliveryMethodTypes)
          ? node.deliveryMethodTypes.filter((value): value is string => typeof value === 'string')
          : [],
        metafieldValue: metafieldValue(node),
      }))
  }
}
