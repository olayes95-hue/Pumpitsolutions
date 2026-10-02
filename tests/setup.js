import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Démonte le DOM React après chaque test pour éviter les fuites entre tests.
afterEach(() => {
  cleanup()
})
