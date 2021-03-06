#!/usr/bin/env node
/**
 * Generates `IconType` components from SVG files using the filename as the component name
 * Uses SVGR https://www.smooth-code.com/open-source/svgr/
 *
 */
import fs from 'fs'
import path from 'path'
/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
// @ts-ignore
import svgr from '@svgr/core'
import chalk from 'chalk'

interface IIcon {
  readonly fileName: string
  readonly componentName: string
  readonly svg: string
}

async function pause(ms = 2000): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

/**
 * Recursively remove a directory
 * @param dir path of directory to remove
 * @param onlyContents true if the only directory contents should be deleted
 */
function removeDir(dir: string, onlyContents = false): void {
  const contents = fs.readdirSync(dir)

  for (const content of contents) {
    const item = path.join(dir, content)
    const stats = fs.statSync(item)

    if (stats.isDirectory()) {
      removeDir(item)
    } else {
      fs.unlinkSync(item)
    }
  }

  if (!onlyContents) {
    fs.rmdirSync(dir)
  }
}

async function wipeDir(dir: string): Promise<void> {
  let retries = 5

  while (retries > 0) {
    try {
      removeDir(dir, true)
      break
    } catch (error) {
      const err = error as { readonly code: string }
      if (err.code === 'ENOENT') {
        break
      }

      if (err.code !== 'ENOTEMPTY' && err.code !== 'EPERM') {
        throw error
      }

      if (retries === 1) {
        throw error
      }

      console.log(err.code, ', retrying...', dir)
      retries--
      await pause()
    }
  }
}

/**
 * Turn the filename into a PascalCase component name
 */
function generateComponentName(fileName: string): string {
  return `${fileName.replace(
    /(^[A-Za-z0-9])|([^A-Za-z0-9]+[A-Za-z0-9])/gi,
    match => match.charAt(match.length - 1).toUpperCase()
  )}Icon`
}

async function parseSVG(svg: string): Promise<string> {
  // Just return minimal parsed SVG code here since too much
  // TypeScript information is stripped away by this parsing
  // eslint-disable-next-line @typescript-eslint/promise-function-async, @typescript-eslint/no-explicit-any
  const tsTemplate = ({ template }: any, _: any, { jsx }: any) => {
    const typeScriptTpl = template.smart({
      plugins: ['typescript'],
    })
    return typeScriptTpl.ast`const Svg = React.memo((props: React.SVGProps<SVGSVGElement>) => ${jsx})`
  }

  const op: string = await svgr(svg, {
    icon: true,
    template: tsTemplate,
    replaceAttrValues: {
      '#676767': 'currentColor',
    },
    plugins: [
      require.resolve('@svgr/plugin-jsx'),
      require.resolve('@svgr/plugin-prettier'),
    ],
  })

  return op
}

const WARNING_LABEL = chalk.yellow('warning')
const DEFS_ELEMENT = chalk.white('<') + chalk.green('defs') + chalk.white('>')

async function parseIcon(
  inputPath: string,
  icon: fs.Dirent
): Promise<IIcon | undefined> {
  const fileName = icon.name.split('.')[0]
  const componentName = generateComponentName(fileName)

  try {
    const svgCode = fs.readFileSync(path.join(inputPath, icon.name), 'utf8')

    const op = await parseSVG(svgCode)

    if (op.includes('<defs>')) {
      console.warn(
        `${WARNING_LABEL} ${chalk.blue(
          icon.name
        )} contains a ${DEFS_ELEMENT} element. These definitions will be global and might affect other icons at runtime.`
      )
    }

    return {
      fileName,
      componentName,
      svg: op,
    }
  } catch (error) {
    console.log('Failed to parse file', icon.name, error)
  }

  return undefined
}

function generateIcon(output: string, icon: IIcon): void {
  const contents = `import React from 'react'

${icon.svg}

export const ${icon.componentName} = Svg
`
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, `${icon.fileName}.tsx`), contents)
}

function generateBarrel(output: string, icons: ReadonlyArray<IIcon>): void {
  const contents = `${icons
    .map(icon => icon.fileName)
    .sort((a, b) => a.localeCompare(b))
    .map(fileName => `export * from './${fileName}'\n`)
    .join('')}`

  fs.mkdirSync(output, { recursive: true })

  fs.writeFileSync(path.join(output, 'index.ts'), contents)
}

async function processDir(
  inputPath: string,
  outputPath: string
): Promise<void> {
  console.log(`Generating Icon's`)

  const iconMap: Map<string, IIcon> = new Map()

  const dirEnts = fs
    .readdirSync(inputPath, { withFileTypes: true })
    .filter(de => de.isFile() && path.extname(de.name) === '.svg')

  for (const de of dirEnts) {
    const icon = await parseIcon(inputPath, de)

    if (icon !== undefined) {
      iconMap.set(icon.componentName, icon)
    }
  }

  if (iconMap.size === 0) {
    console.log('No icons generated')
    return
  }

  await wipeDir(outputPath)

  const icons = Array.from(iconMap.values())

  icons.forEach(icon => generateIcon(outputPath, icon))

  generateBarrel(outputPath, icons)
}

async function main(): Promise<void> {
  const arg1 = process.argv[2]
  const arg2 = process.argv[3] as string | undefined
  const arg3 = process.argv[4] as string | undefined

  const inputPath = arg1
  const outputPath = arg2
  const watch = arg3 === '--watch' || arg3 === '-w'

  if (outputPath === undefined) {
    console.log(
      'Usage: ts-node icon-code-gen.ts <path to svg files> <output path> [--watch | -w]'
    )
    process.exit(1)
    return
  }

  if (!watch) {
    await processDir(inputPath, outputPath)
    return
  }

  console.log('Start generating Icon components in watch mode')
  const watcher = fs.watch(inputPath)
  let timeout: ReturnType<typeof setTimeout> | undefined

  // track changes later
  watcher.on('change', () => {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      timeout = undefined
      void processDir(inputPath, outputPath).catch(console.error)
    }, 250)
  })
}

void main().catch(error => {
  console.error('Icon generation failed', error)
})
