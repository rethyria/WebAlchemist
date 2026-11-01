import { describe, expect, it } from 'vitest'
import { endpointProblem, isLoopbackHostname } from './endpoint-policy'

describe('the endpoint rule', () => {
  it.each([
    'https://api.example.com/v1',
    'https://api.example.com:8443/v1',
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://127.5.6.7/v1',
    'http://[::1]:8080/v1',
    'https://localhost/v1',
  ])('allows %s', (url) => {
    expect(endpointProblem(url)).toBeNull()
  })

  it.each([
    ['http://api.example.com/v1', /https/],
    ['http://192.168.1.20:8080/v1', /https/],
    ['http://localhost.example.com/v1', /https/],
    ['http://127.0.0.1.example.com/v1', /https/],
    ['http://[::2]/v1', /https/],
    ['ftp://localhost/v1', /https/],
    ['file:///etc/passwd', /https/],
    ['javascript:alert(1)', /https/],
    ['not a url', /not a valid/],
    ['', /not a valid/],
  ])('refuses %s', (url, reason) => {
    expect(endpointProblem(url)).toMatch(reason)
  })

  it('treats the same hosts as loopback everywhere', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('128.0.0.1')).toBe(false)
    expect(isLoopbackHostname('example.com')).toBe(false)
  })
})
