"use strict";

var Robe = require('robe');
var request = require('co-request')
var co =require('co');
var iconv = require('iconv-lite');
var $= require('cheerio')

var db;
var collection;

var startIndex  = 1;

var RETRY_RATE = 5000;

function* forEachDom(dom, fn) {
    for (var i = 0; i<dom.length; i++) {
        yield * fn(dom.get(i))
    }
}

function* foreach(arr, fn) {
    for (var i = 0; i <arr.length; i++) {
        yield * fn(arr[i]);
        return;//DEBUG
    }
}

function sleep(ms) {
    return function (callback) {
        setTimeout(callback, ms);
    };
}

function* fetch(url){
    var raw;
    while(!raw||raw.statusCode!==200){
        try{
            raw = yield request(
                {
                    uri: url,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.65 Safari/537.36',
                        'Host': 'hotels.ctrip.com'
                    },
                    encoding:'binary'
                });
        }
        catch(err){
            console.log('[错误] 读取网页失败', err.status);
        }
        if(!raw||raw.statusCode!==200) yield sleep(RETRY_RATE);
    }
    return  iconv.decode(iconv.encode(raw.body, 'binary'),'gb2312');
}

function* ctrip(index){
    var html = yield fetch('http://hotels.ctrip.com/hotel/shanghai2/p' + index);
    yield foreach($('.searchresult_list', '#hotel_list', html), getReviews);
    if(index<300)   ctrip(index++);
}

function* getReviews(dom){
    if(dom.attribs&&dom.attribs.id&&/^\d+$/.exec(dom.attribs.id)){
        var pageid = dom.attribs.id;
        console.log('[抓取酒店] ID:' + pageid);
        var hotel = {};
        hotel.cid = pageid;
        //首次获取信息
        var nextUri = 'http://hotels.ctrip.com/hotel/dianping/'+pageid+'_p1t0.html';
        var html = yield fetch(nextUri);

        var $$ = $.load(html);
        hotel.cnn = $$('.cn_n', '.htl_info_com').text();
        hotel.enn = $$('.en_n', '.htl_info_com').text();
        hotel.star = $$('#ctl00_MainContentPlaceHolder_commonHead1_imgStar', '.htl_info_com').attr('title');
        hotel.address = $$('.adress', '.htl_info_com').text().replace(/\s+?/g, '');
        hotel.detail = $$('#ctl00_MainContentPlaceHolder_hotelDetailInfo_lbDesc').text().replace(/\s+?/g, '');
        hotel.comments =[];

        //console.log(hotel);
        var maxIndex = parseInt($$('.c_page_ellipsis + a').text());
        console.log(maxIndex);
        for(var index = 1; index<=maxIndex; index++){
            nextUri = 'http://hotels.ctrip.com/Domestic/tool/AjaxHotelCommentList.aspx?hotel='+pageid+'&currentPage='+index;
            html = yield fetch(nextUri);
            console.log('[抓取评论]' + hotel.cnn +'：'+index+'/'+maxIndex);

            var comments = $$('.comment_block', html);
            for(var i=0; i<comments.length; i++){
                var comment={};
                comment.scores = [];
                var $$$ = $.load(comments[i]);
                var text = $$$('.small_c').attr('data-value');
                text.split(',').forEach(function(data,i){
                    comment.scores.push(parseInt(data.split(':')[1]));
                });
                comment.text = $$$('.J_commentDetail').text();
                $$$('.room').remove();
                comment.tag = $$$('.comment_bar_info').remove('.room').text();
                hotel.comments.push(comment);
            }
        }
        console.log('[抓取入库]' + hotel.cnn);
        yield collection.insert(hotel);
        console.log('[抓取完毕]' + hotel.cnn);
    }
}


co(function* start(){
    //Mongodb
    db = yield Robe.connect('127.0.0.1');
    collection = db.collection('rScraper');
    //Start
    ctrip(startIndex);
}).catch(function (err){
    console.log('[出错]', err);
});