export type TablePermissions = {
    create?: boolean;
    insert?: boolean;
    drop?: boolean;
};

export const NO_TABLE_PERMISSIONS: TablePermissions = {
    create: false,
    insert: false,
    drop: false,
};
