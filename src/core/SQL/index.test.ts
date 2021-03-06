import {
    createSQL,
    createQueryFromSchema,
    readingQueryMatch,
    writingQueryMatch,
    tableFromReadQuery,
    tableFromWritingQuery,
    registerQueryListeners,
    triggerActuators,
    executeQuery,
    queryPipeline,
    insertQueryPipeline,
    database,
} from "./index";

// Types
import {
    WasmSources,
    Schema,
    Recorder,
} from '../../types'

describe('Create Database to initialise the library', function () {
    describe('createQueryFromSchema', () => {
        it('should create a "CREATE TABLE" query', () => {
            const schema: Schema = {
                test: {
                    fields: {id: 'INTEGER', age: 'INTEGER', name: 'TEXT'},
                }
            }

            const [query] = createQueryFromSchema(schema)

            expect(query).toEqual(
                "CREATE TABLE test (id INTEGER, age INTEGER, name TEXT);"
            )
        })

        it('should create a "CREATE TABLE" and "INSERT INTO" query', () => {
            const schema: Schema = {
                test: {
                    fields: {id: 'INTEGER', age: 'INTEGER', name: 'TEXT'},
                    values: [{id: 1, age: 10, name: 'Ling'}, {id: 2, age: 18, name: 'Paul'}]
                }
            }

            const [query] = createQueryFromSchema(schema)

            expect(query).toEqual(
                "CREATE TABLE test (id INTEGER, age INTEGER, name TEXT);"
                + "INSERT INTO test VALUES (1, 10, 'Ling');"
                + "INSERT INTO test VALUES (2, 18, 'Paul');"
            )
        })
    });

    describe('createSQL', () => {
        it('should initialize a database instance', async () => {
            const schema: Schema = {
                test: {
                    fields: {id: 'INTEGER', age: 'INTEGER', name: 'TEXT'},
                }
            }

            const db = await createSQL(WasmSources.test, schema)

            expect(db).toBeTruthy()
            expect(db).toHaveProperty('exec')
        }, 5000)

        it('should execute a SQL query', async () => {
            const schema: Schema = {
                test: {
                    fields: {id: 'INTEGER', age: 'INTEGER', name: 'TEXT'},
                    values: [{id: 1, age: 10, name: 'Ling'}, {id: 2, age: 18, name: 'Paul'}]
                }
            }

            const db = await createSQL(WasmSources.test, schema)

            const result = db!.exec(
                 "SELECT id FROM test;"
                + "SELECT age,name FROM test WHERE id=$id1",
                {
                    "$id1": 1, ":age1": 1, "@name1": "Ling",
                    "$id2": 2, ":age2": 18, "@name2": "Paul"
                }
            );

            expect(result).toEqual([
                {columns:['id'],values:[[1],[2]]},
                {columns:["age","name"],values:[[10,"Ling"]]},
            ])
        }, 5000)
    })

    describe('executeQuery',  () => {
        beforeAll(() => {
            jest.resetAllMocks()
            database.destroy()
        })

        afterEach(() => {
            jest.resetAllMocks()
        })

        it('should log and error because db was not initialized', () => {
            const test = jest.fn()
            const spyOnLogError = jest.spyOn(console, 'error')
            const result = executeQuery('SELECT * FROM test')
            expect(spyOnLogError).toHaveBeenCalledWith('SQL-lite instance not initiated! \nRun createSQL function to initialize the service.')
            expect(result).toEqual(undefined)
        })

        it('should execute a simple query', async () => {
            const schema: Schema = {
                test: {
                    fields: {id: 'INTEGER', age: 'INTEGER', name: 'TEXT'},
                    values: [{id: 1, age: 10, name: 'Ling'}, {id: 2, age: 18, name: 'Paul'}]
                }
            }

            await createSQL(WasmSources.test, schema)

            const spyOnLogError = jest.spyOn(console, 'error')
            const result = executeQuery('SELECT * FROM test')
            expect(spyOnLogError).not.toHaveBeenCalled()
            expect(result).toEqual([{"columns": ["id", "age", "name"], "values": [[1, 10, "Ling"], [2, 18, "Paul"]]}])
        })

        it('should execute a query with params', async () => {
            const schema: Schema = {
                test: {
                    fields: {id: 'INTEGER', age: 'INTEGER', name: 'TEXT'},
                    values: [{id: 1, age: 10, name: 'Ling'}, {id: 2, age: 18, name: 'Paul'}]
                }
            }

            await createSQL(WasmSources.test, schema)

            const spyOnLogError = jest.spyOn(console, 'error')
            const result = executeQuery(
                "SELECT age,name FROM test WHERE id=$id1",
                {
                    "$id1": 2,
                })
            expect(spyOnLogError).not.toHaveBeenCalled()
            expect(result).toEqual([{"columns": ["age", "name"], "values": [[18, "Paul"]]}])
        })

        it('should return empty results', async () => {
            await createSQL(WasmSources.test, {})

            const spyOnLogError = jest.spyOn(console, 'error').mockImplementation(() => {/*Silent*/})
            const result = executeQuery(
                "SELECT age,name FROM test",
                )
            expect(spyOnLogError).toHaveBeenCalledWith('SQL-lite Error: no such table: test')
            expect(result).toEqual(undefined)
        })
    });

    describe('readingQueryMatch', () => {
        it('should return null for writing query', () => {
            const regEx = readingQueryMatch(
                "INSERT INTO test VALUES ($id1, :age1, @name1);",
                ['test', 'table1', 'table2'],
            )

            expect(regEx).toEqual(null)
        })

        it('should return the match result for an reading query', () => {
            const regEx = readingQueryMatch(
                "SELECT age,name FROM test WHERE id=$id1",
                ['test', 'table1', 'table2'],
            )

            expect(JSON.stringify(regEx)).toEqual(JSON.stringify(["SELECT age,name FROM test", "SELECT", "test"]))
        })
    })

    describe('writingQueryMatch', () => {
        it('should return the match for a writing query', () => {
            const regEx = writingQueryMatch(
                "INSERT INTO test VALUES ($id1, :age1, @name1);",
                ['test', 'table1', 'table2'],
            )

            expect(JSON.stringify(regEx)).toEqual(JSON.stringify(["INSERT INTO test", "INSERT INTO", "test"]))
        })

        it('should return null for an reading query', () => {
            const regEx = writingQueryMatch(
                "SELECT age,name FROM test WHERE id=$id1",
                ['test', 'table1', 'table2'],
            )

            expect(regEx).toEqual(null)
        })
    })

    describe('tableFromReadQuery', () => {
        it('should return null for writing query', () => {
            const table = tableFromReadQuery(
                "INSERT INTO test VALUES ($id1, :age1, @name1);",
                ['test', 'table1', 'table2'],
            )

            expect(table).toEqual(null)
        })

        it('should return the table name in a reading query', () => {
            const table = tableFromReadQuery(
                "SELECT age,name FROM test WHERE id=$id1",
                ['test', 'table1', 'table2'],
            )

            expect(table).toEqual("test")
        })
    })

    describe('tableFromWritingQuery', () => {
        it('should return the table name in a writing query', () => {
            const table = tableFromWritingQuery(
                "INSERT INTO test VALUES ($id1, :age1, @name1);",
                ['test', 'table1', 'table2'],
            )

            expect(table).toEqual("test")
        })

        it('should return null in a reading query', () => {
            const table = tableFromWritingQuery(
                "SELECT age,name FROM test WHERE id=$id1",
                ['test', 'table1', 'table2'],
            )

            expect(table).toEqual(null)
        })
    })

    describe('registerQueryListeners', () => {
        it('should ignore a writing query', () => {
            const updateState = jest.fn()

            const recorder: Recorder = {}

            registerQueryListeners(
                updateState,
            "INSERT INTO test VALUES ($id1, :age1, @name1);",
                ['test', 'table1', 'table2'],
                recorder
            )

            expect(recorder).toEqual({})
        })

        it('should register a new listener for an reading query', () => {
            const updateState = jest.fn()

            const recorder: Recorder = {}

            registerQueryListeners(
                updateState,
                "SELECT age,name FROM test WHERE id=$id1",
                ['test', 'table1', 'table2'],
                recorder
            )
            const actuator = recorder['test'][0].deref()
            expect(actuator).toEqual(updateState)
        })
    })

    describe('triggerActuators', () => {
        const updateState = jest.fn()
        const recorder: Recorder = {
            test: []
        }

        beforeAll(() => {
            // @ts-ignore
            recorder['test']= [new WeakRef(updateState)]
        })

        beforeEach(() => {
            jest.resetAllMocks()
            Date.now = jest.fn(() => 1649577131008)
        })

        it('should trigger the actuators for a writing query', () => {

            triggerActuators(
                "INSERT INTO test VALUES ($id1, :age1, @name1);",
                ['test', 'table1', 'table2'],
                recorder
            )

            expect(updateState).toHaveBeenLastCalledWith(1649577131008)
        })

        it('should ignore a reading query', () => {
            triggerActuators(
                "SELECT age,name FROM test WHERE id=$id1",
                ['test', 'table1', 'table2'],
                recorder
            )

            expect(updateState).not.toHaveBeenCalled()
        })
    })

    describe('queryPipeline', () => {
        beforeAll(async () => {
            const schema: Schema = {
                test: {
                    fields: {id: 'INTEGER', age: 'INTEGER', name: 'TEXT'},
                    values: [{id: 1, age: 10, name: 'Ling'}, {id: 2, age: 18, name: 'Paul'}]
                }
            }

            await createSQL(WasmSources.test, schema)
        })

        beforeEach(() => {
            jest.resetAllMocks()
            Date.now = jest.fn(() => 1649577131008)
        })

        const updateStateFn = jest.fn()

        it('should execute a select query', () => {
            const result = queryPipeline(updateStateFn, "SELECT age,name FROM test WHERE id=2")
            expect(result).toEqual([{"columns": ["age", "name"], "values": [[18, "Paul"]]}])
            expect(updateStateFn).not.toHaveBeenCalled()
        })

        it('should execute a insert query and trigger the updateStateFn', () => {
            const result = queryPipeline(updateStateFn, "INSERT INTO test VALUES (3, 20, 'Jane');")
            expect(result).toEqual([])
            expect(updateStateFn).toHaveBeenCalledWith(1649577131008)
        })
    })

    describe('insertQueryPipeline', () => {
        const updateStateFn = jest.fn()

        beforeAll(async () => {
            const schema: Schema = {
                test: {
                    fields: {id: 'INTEGER', age: 'INTEGER', name: 'TEXT'},
                    values: [{id: 1, age: 10, name: 'Ling'}, {id: 2, age: 18, name: 'Paul'}]
                }
            }

            await createSQL(WasmSources.test, schema)
        })

        beforeEach(() => {
            jest.resetAllMocks()
            Date.now = jest.fn(() => 1649577131008)
        })

        it('should ignore select queries', () => {
            const recorder: Recorder = {
                test: [new WeakRef(updateStateFn)]
            }

            const result = insertQueryPipeline(
                updateStateFn,
                "SELECT age,name FROM test WHERE id=2",
                undefined,
                recorder,
            )
            expect(result).toEqual(undefined)
            expect(updateStateFn).not.toHaveBeenCalled()
        })

        it('should execute input queries', () => {
            const recorder: Recorder = {
                test: [new WeakRef(updateStateFn)]
            }

            const result = insertQueryPipeline(
                updateStateFn,
                "INSERT INTO test VALUES (3, 20, 'Jane');",
                undefined,
                recorder,
            )
            expect(result).toEqual([])
            expect(updateStateFn).toHaveBeenCalledWith(1649577131008)
        })
    })
});