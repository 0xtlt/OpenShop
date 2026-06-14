import type { AnyFunctionDefinition, CombinesWith, DiscountMode, FunctionOwner } from '#types'
import { DISCOUNT_MUTATIONS, FUNCTION_MUTATIONS, type MutationSet } from './function-mutation-map.ts'

export interface ShopifyUserError {
  field: string
  message: string
}

export interface MutationRequest {
  mutation: string
  variables: Record<string, unknown>
}

export const METAFIELD_NAMESPACE = '$app:openshop'

export function getMutations(def: AnyFunctionDefinition, mode?: DiscountMode): MutationSet | null {
  if (def.type === 'discount') {
    return DISCOUNT_MUTATIONS[mode ?? (def.modes?.[0] ?? 'automatic')]
  }
  return FUNCTION_MUTATIONS[def.type]
}

export function gql(data: unknown): Record<string, Record<string, unknown>> {
  if (typeof data === 'object' && data !== null) return data as Record<string, Record<string, unknown>>
  return {}
}

export function extractErrors(data: unknown): ShopifyUserError[] {
  const obj = gql(data)
  const mutationKey = Object.keys(obj).find((k) => k !== 'extensions')
  if (!mutationKey) return []
  const result = obj[mutationKey]
  return (Array.isArray(result?.userErrors) ? result.userErrors : []) as ShopifyUserError[]
}

export function extractPayload(data: unknown): Record<string, unknown> | null {
  const obj = gql(data)
  const mutationKey = Object.keys(obj).find((k) => k !== 'extensions')
  return mutationKey ? obj[mutationKey] : null
}

export function resolveTitle(owner: AnyFunctionDefinition['owner'], config: Record<string, unknown>): string {
  if (!owner) return 'Untitled'
  const title = owner.title
  return typeof title === 'function'
    ? (title as FunctionOwner<Record<string, unknown>>['title'] & ((config: Record<string, unknown>) => string))(config)
    : title
}

export function buildMetafield(handle: string, config: Record<string, unknown>) {
  return {
    namespace: METAFIELD_NAMESPACE,
    key: handle,
    type: 'json',
    value: JSON.stringify(config),
  }
}

function combinesWith(owner: AnyFunctionDefinition['owner']): CombinesWith {
  return owner?.combinesWith ?? {}
}

export function buildCreateMutation(
  def: AnyFunctionDefinition,
  handle: string,
  mode: DiscountMode,
  title: string,
  fnConfig: Record<string, unknown>,
  body: Record<string, unknown>,
): MutationRequest | null {
  const metafield = buildMetafield(handle, fnConfig)

  if (def.type === 'discount') {
    if (mode === 'automatic') {
      return {
        mutation: `#graphql
          mutation CreateAutoDiscount($input: DiscountAutomaticAppInput!) {
            discountAutomaticAppCreate(automaticAppDiscount: $input) {
              automaticAppDiscount { discountId }
              userErrors { field message }
            }
          }`,
        variables: {
          input: {
            functionHandle: handle,
            title,
            startsAt: body.startsAt ?? new Date().toISOString(),
            endsAt: body.endsAt ?? null,
            combinesWith: combinesWith(def.owner),
            metafields: [metafield],
          },
        },
      }
    }

    return {
      mutation: `#graphql
        mutation CreateCodeDiscount($input: DiscountCodeAppInput!) {
          discountCodeAppCreate(codeAppDiscount: $input) {
            codeAppDiscount { discountId }
            userErrors { field message }
          }
        }`,
      variables: {
        input: {
          functionHandle: handle,
          title,
          code: body.code,
          startsAt: body.startsAt ?? new Date().toISOString(),
          endsAt: body.endsAt ?? null,
          usageLimit: body.usageLimit ?? null,
          combinesWith: combinesWith(def.owner),
          metafields: [metafield],
        },
      },
    }
  }

  if (def.type === 'cart-transform') {
    return {
      mutation: `#graphql
        mutation CreateCartTransform($functionHandle: String!, $blockOnFailure: Boolean, $metafields: [MetafieldInput!]) {
          cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: $blockOnFailure, metafields: $metafields) {
            cartTransform { id }
            userErrors { field message }
          }
        }`,
      variables: { functionHandle: handle, blockOnFailure: body.blockOnFailure ?? false, metafields: [metafield] },
    }
  }

  if (def.type === 'fulfillment-constraints') {
    return {
      mutation: `#graphql
        mutation CreateFulfillmentConstraint($functionHandle: String!, $deliveryMethodTypes: [DeliveryMethodType!]!, $metafields: [MetafieldInput!]) {
          fulfillmentConstraintRuleCreate(functionHandle: $functionHandle, deliveryMethodTypes: $deliveryMethodTypes, metafields: $metafields) {
            fulfillmentConstraintRule { id }
            userErrors { field message }
          }
        }`,
      variables: { functionHandle: handle, deliveryMethodTypes: body.deliveryMethodTypes ?? ['SHIPPING'], metafields: [metafield] },
    }
  }

  if (def.type === 'delivery-customization') {
    return {
      mutation: `#graphql
        mutation CreateDeliveryCustomization($input: DeliveryCustomizationInput!) {
          deliveryCustomizationCreate(deliveryCustomization: $input) {
            deliveryCustomization { id }
            userErrors { field message }
          }
        }`,
      variables: { input: { functionHandle: handle, title, enabled: true, metafields: [metafield] } },
    }
  }

  if (def.type === 'payment-customization') {
    return {
      mutation: `#graphql
        mutation CreatePaymentCustomization($input: PaymentCustomizationInput!) {
          paymentCustomizationCreate(paymentCustomization: $input) {
            paymentCustomization { id }
            userErrors { field message }
          }
        }`,
      variables: { input: { functionHandle: handle, title, enabled: true, metafields: [metafield] } },
    }
  }

  if (def.type === 'checkout-validation') {
    return {
      mutation: `#graphql
        mutation CreateValidation($input: ValidationCreateInput!) {
          validationCreate(validation: $input) {
            validation { id }
            userErrors { field message }
          }
        }`,
      variables: { input: { functionHandle: handle, title, enable: true, blockOnFailure: body.blockOnFailure ?? false, metafields: [metafield] } },
    }
  }

  return null
}

export function buildUpdateMutation(
  def: AnyFunctionDefinition,
  handle: string,
  mode: DiscountMode,
  id: string,
  title: string,
  fnConfig: Record<string, unknown>,
  body: Record<string, unknown>,
): MutationRequest | null {
  const metafield = buildMetafield(handle, fnConfig)

  if (def.type === 'discount' && mode === 'automatic') {
    return {
      mutation: `#graphql
        mutation UpdateAutoDiscount($id: ID!, $input: DiscountAutomaticAppInput!) {
          discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $input) {
            userErrors { field message }
          }
        }`,
      variables: { id, input: { title, startsAt: body.startsAt, endsAt: body.endsAt, combinesWith: def.owner?.combinesWith, metafields: [metafield] } },
    }
  }

  if (def.type === 'discount' && mode === 'code') {
    return {
      mutation: `#graphql
        mutation UpdateCodeDiscount($id: ID!, $input: DiscountCodeAppInput!) {
          discountCodeAppUpdate(id: $id, codeAppDiscount: $input) {
            userErrors { field message }
          }
        }`,
      variables: { id, input: { title, startsAt: body.startsAt, endsAt: body.endsAt, usageLimit: body.usageLimit, combinesWith: def.owner?.combinesWith, metafields: [metafield] } },
    }
  }

  if (def.type === 'delivery-customization') {
    return {
      mutation: `#graphql
        mutation UpdateDeliveryCustomization($id: ID!, $input: DeliveryCustomizationInput!) {
          deliveryCustomizationUpdate(id: $id, deliveryCustomization: $input) {
            userErrors { field message }
          }
        }`,
      variables: { id, input: { title, enabled: body.enabled, metafields: [metafield] } },
    }
  }

  if (def.type === 'payment-customization') {
    return {
      mutation: `#graphql
        mutation UpdatePaymentCustomization($id: ID!, $input: PaymentCustomizationInput!) {
          paymentCustomizationUpdate(id: $id, paymentCustomization: $input) {
            userErrors { field message }
          }
        }`,
      variables: { id, input: { title, enabled: body.enabled, metafields: [metafield] } },
    }
  }

  if (def.type === 'checkout-validation') {
    return {
      mutation: `#graphql
        mutation UpdateValidation($id: ID!, $input: ValidationUpdateInput!) {
          validationUpdate(id: $id, validation: $input) {
            userErrors { field message }
          }
        }`,
      variables: { id, input: { title, enable: body.enabled, blockOnFailure: body.blockOnFailure, metafields: [metafield] } },
    }
  }

  return null
}

export function buildDeleteMutation(mutationName: string, id: string): MutationRequest {
  return {
    mutation: `#graphql
      mutation DeleteFunctionInstance($id: ID!) {
        ${mutationName}(id: $id) {
          userErrors { field message }
        }
      }`,
    variables: { id },
  }
}
