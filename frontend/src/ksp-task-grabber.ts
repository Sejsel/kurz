
export type TaskAssignmentData = {
    id: string,
    name: string,
    points: number | null,
    description: string,
    titleHtml: string
}

type TaskLocation = {
    /** Relative location of HTML file containing this task */
    url: string
    /** id of the element where the specific task begins */
    startElement: string
}

export type TaskStatus = {
    id: string
    name: string
    submitted: boolean
    solved: boolean
    points: number
    maxPoints: number
    type: string
}

function fixAllLinks(e: any) {
    if (typeof e.src == "string") {
        e.src = e.src
    }
    if (typeof e.href == "string") {
        e.href = e.href
    }
    let c = (e as HTMLElement).firstElementChild
    while (c) {
        fixAllLinks(c)
        c = c.nextElementSibling
    }
}

export type ParsedTaskId = {
    rocnik: string
    z: boolean
    serie: string
    uloha: string
}

export function parseTaskId(id: string): ParsedTaskId | null {
    const m = /^(\d+)-(Z?)(\d)-(\d)$/.exec(id)
    if (!m) return null
    const [_, rocnik, z, serie, uloha] = m
    return { rocnik, z: !!z, serie, uloha }
}

function getLocation(id: string, solution: boolean): TaskLocation {
    const parsedId = parseTaskId(id)
    if (!parsedId) {
        throw new Error("Can not parse " + id)
    }
    const { rocnik, z, serie, uloha } = parsedId
    const urlX = solution ? "reseni" : "zadani"
    if (z) {
        return {
            url: `/z/ulohy/${rocnik}/${urlX}${serie}.html`,
            startElement: `task-${id}`
        }
    } else {
        return {
            url: `/h/ulohy/${rocnik}/${urlX}${serie}.html`,
            startElement: `task-${id}`
        }
    }
}

function htmlEncode(text: string): string {
    const p = document.createElement("p")
    p.textContent = text
    return p.innerHTML
}

function parseTask(startElementId: string, doc: HTMLDocument): TaskAssignmentData {
    const titleElement = doc.getElementById(startElementId)
    if (!titleElement)
        throw new Error(`Document does not contain ${startElementId}`)
    fixAllLinks(titleElement)

    let e = titleElement

    const titleMatch = /^(\d+-Z?\d+-\d+) (.*?)( \((\d+) bod.*\))?$/.exec(e.textContent!.trim())
    if (!titleMatch) {
        var [_, id, name, __, points] = ["", startElementId, "Neznámé jméno úlohy", "", ""]
    } else {
        var [_, id, name, __, points] = titleMatch
    }

    e = e.nextElementSibling as HTMLElement

    // skip first <hr>
    while (e.nextElementSibling &&
           e.tagName.toLowerCase() == "hr")
        e = e.nextElementSibling as HTMLElement


    // hack: remove img tag that shows this task is a practical one. Some tasks have it, some don't, so we remove it for consistency
    const intoImgTag = e.firstElementChild
    if (intoImgTag && intoImgTag.tagName.toLowerCase() == "img" && intoImgTag.classList.contains("leftfloat")) {
        intoImgTag.remove()
    }

    let r = ""

    copyElements: while (!e.classList.contains("story") &&
        //    !e.classList.contains("clearfloat") &&
           e.tagName.toLowerCase() != "h3" &&
           e.textContent!.trim() != "Řešení"
        ) {

        processElement: {
            // hack: remove the paragraph with the matching text. Occurs in KSP-H, but is useless in this context.
            if (e.textContent!.trim().replace(/\s+/g, " ") == "Toto je praktická open-data úloha. V odevzdávacím systému si necháte vygenerovat vstupy a odevzdáte příslušné výstupy. Záleží jen na vás, jak výstupy vyrobíte.") {
                break processElement
            }

            fixAllLinks(e)

            r += e.outerHTML + "\n"
        }

        let n = e.nextSibling
        copyNodes: while(true) {
            if (!n) {
                break copyElements
            }
            if (n.nodeType == Node.ELEMENT_NODE) {
                e = n as HTMLElement
                break copyNodes
            } else if (n.nodeType == Node.TEXT_NODE && n.textContent!.trim() != "") {
                r += htmlEncode(n.textContent!)
            }
            n = n.nextSibling
        }
    }

    return {
        description: r,
        id: id.trim(),
        name: name.trim(),
        points: points ? +points : null,
        titleHtml: titleElement.outerHTML
    }
}

function parseTaskStatuses(doc: HTMLDocument): TaskStatus[] {
    const rows = Array.from(doc.querySelectorAll("table.zs-tasklist tr")).slice(1) as HTMLTableRowElement[]
    return rows.map(r => {
        const submitted = !r.classList.contains("zs-unsubmitted")
        const id = r.cells[0].textContent!.trim()
        const type = r.cells[1].textContent!.trim()
        const name = r.cells[2].textContent!.trim()
        const pointsStr = r.cells[4].textContent!.trim()
        const pointsMatch = /((–|\.|\d)+) *\/ *(\d+)/.exec(pointsStr)
        if (!pointsMatch) throw new Error()
        let points = +pointsMatch[2]
        if (isNaN(points)) {
            points = 0
        }
        const maxPoints = +pointsMatch[3]
        const solved = r.classList.contains("zs-submitted")
        return { id, name, submitted, type, points, maxPoints, solved }
    })
}

export async function fetchHtml(url: string) {
    const r = await fetch(url, { headers: { "Accept": "text/html,application/xhtml+xml" } })
    if (r.status >= 400) {
        throw Error(r.statusText)
    }
    const html = await r.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, "text/html")
    if (!doc.head.querySelector("base")) {
        let baseEl = doc.createElement('base');
        baseEl.setAttribute('href', new URL(url, location.href).href);
        doc.head.append(baseEl);
    }
    return doc
}

async function loadTask({ url, startElement }: TaskLocation): Promise<TaskAssignmentData> {
    const html = await fetchHtml(url)
    return parseTask(startElement, html)
}

export function isLoggedIn(): boolean {
    return !!document.querySelector(".auth a[href='/profil/profil.cgi']")
}

export async function grabTaskStates(kspIds: string[]): Promise<Map<string, TaskStatus>> {
    if (!isLoggedIn()) throw new Error()

    const ids = new Set<string>(kspIds.map(parseTaskId).filter(t => t != null).map(t => t!.rocnik))
    const results = await Promise.all(Array.from(ids.keys()).map(async (rocnik) => {
        const html = await fetchHtml(`/cviciste/?year=${rocnik}`)
        return parseTaskStatuses(html)
    }))

    return new Map<string, TaskStatus>(
        ([] as TaskStatus[]).concat(...results)
        .map(r => [r.id, r])
    )
}

export async function grabAssignment(id: string): Promise<TaskAssignmentData> {
    return await loadTask(getLocation(id, false))
}

export async function grabSolution(id: string): Promise<TaskAssignmentData> {
    return await loadTask(getLocation(id, true))
}
