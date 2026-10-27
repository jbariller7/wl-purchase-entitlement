import {describe,it,expect,vi} from 'vitest';
import {searchDirectory,hasDirectoryFilters} from '../integrations/web/admin-console/directory-search.js';

describe('complete customer directory searches',()=>{
  it.each(['registered','purchases','pending'])('finds a third-page match in %s after empty pages',async source=>{
    const fetchPage=vi.fn().mockResolvedValueOnce({rows:[],scanned:100,nextCursor:'second'})
      .mockResolvedValueOnce({rows:[],scanned:100,nextCursor:'third'})
      .mockResolvedValueOnce({rows:[{email:'alicia.meyers@gmail.com'}],scanned:30,nextCursor:null});
    const result=await searchDirectory({filters:{source,q:'alicia'},fetchPage});
    expect(result).toMatchObject({rows:[{email:'alicia.meyers@gmail.com'}],scanned:230,completeSearch:true,nextCursor:null});
    expect(fetchPage).toHaveBeenLastCalledWith({source,q:'alicia',cursor:'third'});
  });
  it('scans all pages even when an early page has matches',async()=>{
    const fetchPage=vi.fn().mockResolvedValueOnce({rows:[{uid:'a'}],scanned:100,nextCursor:'next'})
      .mockResolvedValueOnce({rows:[{uid:'b'}],scanned:5,nextCursor:null});
    expect((await searchDirectory({filters:{access:'premium_lifetime'},fetchPage})).rows).toHaveLength(2);
    expect(fetchPage).toHaveBeenLastCalledWith({access:'premium_lifetime',cursor:'next'});
  });
  it('discards an obsolete search and does not fetch another page',async()=>{
    let current=true;
    const fetchPage=vi.fn(async()=>{current=false;return {rows:[],scanned:100,nextCursor:'next'};});
    expect(await searchDirectory({filters:{},fetchPage,isCurrent:()=>current})).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it('does not present partial results as a completed search on failure',async()=>{
    const fetchPage=vi.fn().mockResolvedValueOnce({rows:[],scanned:100,nextCursor:'next'}).mockRejectedValueOnce(new Error('Network failed'));
    await expect(searchDirectory({filters:{},fetchPage})).rejects.toThrow('Network failed');
  });
  it('rejects repeated cursors instead of looping forever',async()=>{
    const fetchPage=vi.fn().mockResolvedValue({rows:[],scanned:100,nextCursor:'same'});
    await expect(searchDirectory({filters:{},fetchPage})).rejects.toThrow('could not finish');
  });
  it('uses ordinary pagination only for unfiltered browsing',()=>{
    expect(hasDirectoryFilters({source:'purchases',q:' ',access:'all',platform:'all',cloud:'all',status:'all'})).toBe(false);
    for(const filters of [{q:'meyers'},{access:'permanent'},{platform:'desktop'},{cloud:'no'},{status:'disabled'}]) expect(hasDirectoryFilters(filters)).toBe(true);
  });
});
