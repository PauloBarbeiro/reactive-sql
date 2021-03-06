import initSqlJs from 'sql.js'

// Types
import {BindParams, DatabaseHolder, QueryExecResult, Recorder, Schema, SqlLite} from "../../types";

export const createQueryFromSchema = (schema: Schema): [string, Array<string>] => {
    const tables = Object.keys(schema)

    const createTable = "CREATE TABLE"

    let query = ""

    tables.forEach(table => {
        const { fields, values } = schema[table]

        const fieldsPart = Object.keys(fields).reduce((acc, field, idx, keys) => {
            return acc + `${field} ${fields[field]}` + (idx < keys.length - 1 ? ', ' : '')
        }, '')

        const insertPart = values
            ? values.map((data) => {
                const dataPart = Object.keys(data).reduce((acc, key, idx, keys) => {
                    const value = data[key]
                    return acc += (typeof value === "string" ? `'${value}'` : `${value}`) + ((idx < keys.length - 1 ? ', ' : ''))
                }, '')

                return `INSERT INTO ${table} VALUES (${dataPart});`
            }).join('')
            : []

        query += `${createTable} ${table} (${fieldsPart});${insertPart}`
    })

    return [query, tables]
}

export const database: DatabaseHolder = {
    instance: null,
    setInstance: function(db) {
        this.instance = db
    },
    getInstance: function() {
        return this.instance
    },
    destroy: function () {
        this.instance = null
    }
}

const tables: Array<string> = []

const GlobalRecorder: Recorder = {}

export const createSQL = async (path: string, schema: Schema) => {
    try {
        const SQL = await initSqlJs({
            locateFile: () => path
        })

        const db: SqlLite = new SQL.Database()
        database.setInstance(db)

        const [query, tablesList] = createQueryFromSchema(schema)
        tables.push(...tablesList)
        db.exec(query)

        return db
    } catch (e) {
        console.error(e)
    }
    return
}

export const getDatabase = (): SqlLite | null => database.getInstance()

export const readingQueryMatch = (query: string, tables: Array<string>): RegExpMatchArray | null => {
    const readRegEx = new RegExp(`^(SELECT).+(?<table>${tables.join('|')})`)
    return query.match(readRegEx)
}

export const writingQueryMatch = (query: string, tables: Array<string>): RegExpMatchArray | null => {
    const readRegEx = new RegExp(`^(INSERT INTO).+(?<table>${tables.join('|')})`)
    return query.match(readRegEx)
}

export const tableFromReadQuery = (query: string, tables: Array<string>): string | null => {
    const regExRes = readingQueryMatch(query, tables)
    const table = regExRes?.groups?.table
    if(table) {
        return table
    }

    return null
}

export const tableFromWritingQuery = (query: string, tables: Array<string>): string | null => {
    const regExRes = writingQueryMatch(query, tables)
    const table = regExRes?.groups?.table
    if(table) {
        return table
    }

    return null
}

export const registerQueryListeners = (updateState: (time: number) => void, query: string, tables: Array<string>, recorder: Recorder):void => {
    const table = tableFromReadQuery(query, tables)

    if(table) {
        if(!recorder[table]) {
            recorder[table] = []
        }

        recorder[table].push(new WeakRef<(t: number) => void>(updateState))
    }
}

export const triggerActuators = (query: string, tables: Array<string>, recorder: Recorder):void => {
    const table = tableFromWritingQuery(query, tables)

    if(table) {
        const timestamp = Date.now()
        if(!recorder[table]) {
            return
        }

        new Promise((resolve, reject) => {
            try{
                recorder[table].forEach(weakRef => {
                    const fnRef = weakRef.deref()
                    fnRef && fnRef(timestamp)
                })
                resolve(1)
            } catch (err) {
                console.error('UPDATE ERROR: ', err)
                reject()
            }
        })
    }
}

export const executeQuery = (query: string, params?: BindParams): Array<QueryExecResult> | undefined => {
    let db = getDatabase()

    if(!db) {
        console.error('SQL-lite instance not initiated! \nRun createSQL function to initialize the service.')
        return;
    }

    try {
        return db.exec(query, params)
        // @ts-ignore
    } catch (error: Error) {
        console.error(`SQL-lite Error: ${error.message}`)
        return
    }
}

export const queryPipeline = (
    updateStateFn: (time: number) => void,
    query: string,
    params?: BindParams,
): Array<QueryExecResult> | undefined => {
    registerQueryListeners(updateStateFn, query, tables, GlobalRecorder)
    const result = executeQuery(query, params)
    triggerActuators(query, tables, GlobalRecorder)

    return result
}

export const insertQueryPipeline = (
    updateStateFn: (time: number) => void,
    query: string,
    params?: BindParams,
    recorder: Recorder = GlobalRecorder
): Array<QueryExecResult> | undefined => {
    const regExRes = writingQueryMatch(query, tables)
    if(!regExRes) {
        return
    }

    const result = executeQuery(query, params)
    triggerActuators(query, tables, recorder)
    return result
}

export default {
    createQueryFromSchema,
    createSQL,
    queryPipeline,
    insertQueryPipeline,
}