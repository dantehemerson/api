import get from 'lodash.get'

export const getWithState = (data: any) => (path: string, defaultValue?: string) => {
  return get(data, path, defaultValue)
}
