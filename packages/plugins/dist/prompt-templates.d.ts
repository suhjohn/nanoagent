export declare function loadPromptTemplates(dirs: any): Promise<{
    name: string;
    description: any;
    content: any;
    filePath: string;
}[]>;
export declare function expandPromptTemplate(template: any, args: any): any;
export declare function withPromptTemplates(params: any): (options: any) => any;
