"use strict";

// TODO: Move distribution drawing onto new coordinate system
// TODO: centre on canvas in x dimension
// TODO: yInt adjustment?
// TODO: y cap needs to accommodate AUC adjustment
// TODO: accommodate AUC adjustment into y mouse detection
// TODO: calculate and handle payouts
// TODO: highlight hovered option
// TODO: widget label style options
// TODO: callback for drawing x axis options or customisable function


class Distribution {
    /**
     * @constructor
     *
     * Distribution allows the generation of probability distributions (using the normal distribution)
     * on the basis of a specified (x,y) coordinate giving the probability density at the mean
     * (the distribution is symmetrical).
     *
     * The distributions allow for a form of spread betting on a range of possible answers. The range of
     * widths (standard deviations) allowed can be specified using min/maxPrecision, and the distribution
     * is scaled to respect that value to avoid unnecessary whitespace.
     *
     * Betting values can be included. Betting values start with the minimum bet for the minimum precision
     * and increase linearly until the maximum bet is reached at the maximum precision.
     *
     * Probability distributions are draw to the supplied canvas object.
     *
     * Various styling options are available through the style object.
     *
     * @param args {{}}
     * @param args.canvas {HTMLElement} - canvas on which to draw the distribution
     * @param [args.xMin = 0] {number} - x axis minimum
     * @param [args.xMax = 100] {number} - x axis maximum
     * @param [args.xPoints = (xMax-xMin)] - number of points on the x axis
     * @param [args.reverseX = false] {boolean} - whether to reverse x axis labels
     * @param [args.minPrecision = .0] {number} - minimum distribution precision (between 0 and 1)
     * @param [args.maxPrecision = 1.0] {number} - maximum distribution precision (between 0 and 1)
     * @param [args.minBet = .0] {number} - minimum bet amount allowed. Assigned to minPrecision.
     * @param [args.maxBet = 1.0] {number} - maximum bet allowed. Assigned to maxPrecision.
     *
     * @param [args.constantAUC = true] {boolean} - whether to increase inbounds values where parts of
     * the distribution are outside of the limits of the x axis.
     *
     * @param [args.style = {}] {{}} - styling options. Default to Distribution.defaultStyle.
     *
     * @param [args.callback = {}] {{}} - callbacks
     * @param [args.callback.onUpdate = null] {function} - called when Distribution updates from cursor click.
     * Called with the click event as a parameter.
     *
     * @return {Distribution}
     */
    constructor(args) {
        this.canvas = typeof args.canvas === "undefined"? null : args.canvas;
        this.xMin = typeof args.xMin === "undefined"? 0 : args.xMin;
        this.xMax = typeof args.xMax === "undefined"? 100 : args.xMax;
        this.xPoints = typeof args.xPoints === "undefined"? this.xMax - this.xMin : args.xPoints;
        this.reverseX = typeof args.reverseX === "undefined"? false : args.reverseX;
        this.minPrecision = typeof args.minPrecision === "undefined"? .10 : args.minPrecision;
        this.maxPrecision = typeof args.maxPrecision === "undefined"? .9 : args.maxPrecision;
        this.minBet = typeof args.minBet === "undefined"? .10 : args.minBet;
        this.maxBet = typeof args.maxBet === "undefined"? .90 : args.maxBet;

        this.constantAUC = typeof args.constantAUC === "undefined"? true : args.constantAUC;

        this.style = Distribution.defaultStyle;
        if(typeof args.style !== "undefined")
            Object.keys(args.style).forEach((k)=>this.style[k] = args.style[k]);

        this.callback = Distribution.defaultCallbacks;
        if(typeof args.callback !== "undefined")
            Object.keys(args.callback).forEach((k)=>this.callback[k] = args.callback[k]);

        // cartesian coordinates
        this.x = [];
        let step = (this.xMax - this.xMin) / this.xPoints;
        for(let i = 0; i <= this.xMax - this.xMin; i++)
            this.x[i] = this.xMin + step * i;
        if(this.reverseX) {
            this.x = this.x.reverse();
        }
        this.y = [];

        // betting coordinates
        this.bet = {
            yRaw: 0, // y coordinate as a proportion of available y-space
            proportion: 0, // bet as a proportion of available precision space
            amount: this.minBet,
            on: this.xMin + (this.xMax - this.xMin),
            won: 0.0
        };

        // graphics coordinates
        this.drawPoints = {x: [], y: [], yInt: 0};

        this.canvas.distribution = this;
        this.canvas.drawToCanvas = function(event) {
            this.distribution.drawToCanvas(event);
        };
        this.canvas.clickMouse = function(clickEvent) {
            this.registerTrackMouse();
            this.drawToCanvas(clickEvent)
        };
        this.canvas.registerTrackMouse = function(enable = true) {
            if(enable)
                this.addEventListener('mousemove', this.drawToCanvas);
            else
                this.removeEventListener('mousemove', this.drawToCanvas);
        };
        this.canvas.registerClickMouse = function(enable = true) {
            if(enable)
                this.addEventListener('mousedown', this.clickMouse);
            else
                this.removeEventListener('mousedown', this.clickMouse);
        };

        this.canvas.addEventListener('mouseup', ()=>this.canvas.registerTrackMouse(false));
        this.canvas.addEventListener('mouseout', ()=>this.canvas.registerTrackMouse(false));
        this.canvas.registerClickMouse(true);

        // timing of key events
        this.time = {
            bet: -1,
            start: new Date().getTime(),
        };

        return this;
    }

    /**
     * Default style options.
     */
    static get defaultStyle() {
        return {
            gutterX: 0,
            gutterY: 0,
            paddingX: 0,
            paddingY: 0,

            widgetSize: 5,
            showWidgetLabel: true,

            axisStrokeStyleX: 'black',
            axisLineWidthX: 2,
            axisTicksX: 10,
            axisTickSizeX: 5,
            axisLabelFontX: 'Arial',
            axisLabelFontSizeX: 16,
            axisPositionX: 0,

            axisStrokeStyleY: 'black',
            axisLineWidthY: 2,
            axisTicksY: 10,
            axisTickSizeY: 5,
            axisLabelFontY: 'Arial',
            axisLabelFontSizeY: 16,
            axisPositionY: 0,

            precisionPadding: .0,
            precisionStart: .0
        };
    }

    /**
     * Default callbacks.
     */
    static get defaultCallbacks() {
        return {
            onUpdate: null
        };
    }

    /**
     * Avoids numerous recalculations of a square root
     * @return {number} - Math.sqrt(2 * Math.PI)
     */
    static get root2pi() {
        return 2.5066282746310002;
    }

    /**
     * Return f(x) which is the frequency of x in the normal distribution
     * @param x {number[]} base score
     * @param mu {number} mean of the normal distribution
     * @param sd {number} standard deviation of the normal distribution
     * @return {number[]} resulting f(x) values
     */
    static f(x, mu, sd) {
        let y = [];
        const z = 1 / (Distribution.root2pi * sd);
        const w = Math.pow(2*sd, 2);
        for(let i = 0; i < x.length; i++) {
            // normal distribution
            y[i] = z * Math.exp(-(Math.pow(x[i] - mu,2) / w));
        }
        return y;
    }

    /**
     * Find the value z for which the sum of values in y is closest to 0
     * @param y {number[]}
     * @return {number}
     */
    static findIntercept(y) {
        // This can probably just be -(mean of the y values)!
        let error = Infinity;
        let newError = Infinity;
        let z = 0;
        let yNew = [];
        for(let i = utils.getMin(y);
            i < utils.getMax(y);
            i += (utils.getMax(y)-utils.getMin(y)) / y.length) {
            yNew = utils.add(y, -i);
            newError = Math.abs(utils.sum(yNew));
            if(newError < error) {
                error = newError;
                z = i;
            }
        }
        return z;
    }

    /**
     * Find the maximum number of pixels assignable to each point, and the number of pixels left over
     * @param points {int} number of points required
     * @param pixels {int} number of pixels available
     * @return {{ratio: number, remainder: number}}
     */
    static getPixelRatio(points, pixels) {
        let ratio = Math.floor(pixels / points);
        let remainder = pixels - (ratio * points);
        return {ratio, remainder};
    }

    /**
     * @return {number} the standardized height of the graph used for interpreting y values and cursor position
     */
    get proportionalSpaceY() {
        let AUC = 0;
        if(this.constantAUC) {
            // Needs an adjustment term to account for constant AUC
            // ...
        }
        return(this.maxPrecision + this.style.paddingY + AUC);
    }

    /**
     * Number of pixels for each cartesian point
     * @return {{x: number, y: number}}
     */
    get pixelsPerPoint() {
        return {
            x: Distribution.getPixelRatio(this.x.length, this.canvas.clientWidth).ratio,
            y: Distribution.getPixelRatio(this.proportionalSpaceY,
                this.canvas.clientHeight).ratio // y axis 0:maxPrecision
        };
    }

    /**
     * Return the drawPoint from a cartesian point
     * @param point {{x: number, y: number}} cartesian point coordinates
     * @param offset {{x: number, y: number}} offsets for each dimension
     * @param maxY {number} height of the y axis
     * @return {{x: number, y: number}} drawing coordinates
     */
    pointToDrawPoint(point, offset, maxY) {
        return {
            x: (point.x - offset.x) * this.pixelsPerPoint.x,
            y: maxY - (point.y + offset.y)*this.pixelsPerPoint.y
        };
    }

    /**
     * Calculate drawPoints from cartesian points
     * @return Distribution - return self for chaining
     */
    recalculateDrawPoints() {
        let maxY = this.canvas.clientHeight;
        let offset = {
            x: 0,
            y: 0
        };
        for(let i = 0; i < this.x.length; i++) {
            let out = this.pointToDrawPoint({x: i, y: Math.round(this.y[i]*100)/100}, offset, maxY);
            this.drawPoints.x[i] = out.x + this.pixelsPerPoint.x/2;
            this.drawPoints.y[i] = out.y;
        }

        return this;
    }

    getCursorCoordinates(clickEvent) {
        let x = clickEvent.clientX - this.canvas.getBoundingClientRect().left - this.canvas.clientLeft;
        let y = clickEvent.clientY - this.canvas.getBoundingClientRect().top - this.canvas.clientTop;

        // save raw cursor position
        this.cursorPosition = {x, y};

        // reverse y coordinate to handle graphics using reversed y axis
        y = this.canvas.clientHeight - y;

        return {x, y};
    }

    /**
     * Calculate the mean and precision as a function of the cursor position
     * @return {Distribution} - return self for chaining
     */
    updateFromCursor(clickEvent) {
        let cursor = this.getCursorCoordinates(clickEvent);

        // cap the cursor coordinates
        cursor.x = cursor.x < 0? 0 : cursor.x >= this.canvas.clientWidth? this.canvas.clientWidth-1 : cursor.x;
        cursor.y = cursor.y <= 0? 1 : cursor.y > this.canvas.clientHeight? this.canvas.clientHeight : cursor.y;

        // y as proportion of space available
        this.bet.yRaw = (cursor.y * (this.proportionalSpaceY)) / (this.canvas.clientHeight);

        // Clamp by allowed precision range
        this.bet.yRaw = this.bet.yRaw < this.minPrecision?
            this.minPrecision : this.bet.yRaw > this.maxPrecision?
                this.maxPrecision : this.bet.yRaw;
        
        this.bet.proportion = (this.bet.yRaw - this.minPrecision) / (this.maxPrecision - this.minPrecision);

        // desired bet amount is proportion of the betting space available
        this.bet.amount = this.minBet + this.bet.proportion * (this.maxBet - this.minBet);
        // desired mean is the x equivalent value of the mouse x coordinate
        this.bet.index = Math.floor(cursor.x / this.canvas.clientWidth * this.x.length);
        this.bet.on = this.x[this.bet.index];
        this.bet.time = new Date().getTime();

        if(typeof this.callback.onUpdate === "function")
            this.callback.onUpdate(clickEvent);

        return this;
    }

    /**
     * Generate new y values for a given mean and precision
     *
     * @return Distribution - return self for chaining
     */
    updateY() {
        // Y-values need to be scaled to the x-axis range
        let range = (this.xMax - this.xMin);
        let muY = this.bet.yRaw / range * 100;

        // sd has to be such that the highest y value should be muY
        // This can be obtained by rearranging the normal distribution formula for x = mode(x)
        let sd = 1 / (Distribution.root2pi * muY);

        // Calculate the y values
        this.yRaw = Distribution.f(this.x, this.bet.on, sd);

        // Adjust y values for cases where the distribution has portions which are out-of-range
        if(this.constantAUC) {
            // Remainder is the absolute difference of tail areas
            let remainder = 0;
            for(let i = 0; i < this.x.length; i++) {
                if(this.x[i] < this.bet.on)
                    remainder += this.yRaw[i];
                if(this.x[i] > this.bet.on)
                    remainder -= this.yRaw[i];
            }
            remainder = Math.abs(remainder);
            if(remainder/this.x.length !== 0) {
                // increase each y value proportionately to its current value
                let sum = utils.sum(this.yRaw);
                for(let i = 0; i < this.yRaw.length; i++) {
                    this.yRaw[i] += remainder * (this.yRaw[i] / sum);
                }
            }
        }

        // Scale resulting y values to match x axis range
        // let range = this.xMax - this.xMin;
        for(let i = 0; i < this.yRaw.length; i++)
            this.y[i] = this.yRaw[i] * range / 100
        // this.y = this.yRaw

        this.yInt = Distribution.findIntercept(this.y);

        this.drawPoints.yInt = this.pointToDrawPoint(
            {x: 0, y: this.yInt},
            {x: 0, y: 0},
            this.canvas.clientHeight)
            .y;

        //this.yInt = this.canvas.clientHeight/2;

        return this;
    }

    /**
     * Clear the canvas
     * @return {Distribution} self for chaining
     */
    clearCanvas() {
        let ctx = this.canvas.getContext('2d');
        ctx.clearRect(0,0,this.canvas.clientWidth, this.canvas.clientHeight);
        return this;
    }

    drawRectangles() {
        let ctx = this.canvas.getContext('2d');
        ctx.lineWidth = this.pixelsPerPoint.x / 4;
        let strokeStyle = {
            low: ctx.lineWidth <= 1? 'red' : 'white',
            high: ctx.lineWidth <= 1? 'lightblue' : 'white'
        };

        this.drawPoints.x = utils.add(this.drawPoints.x, -this.pixelsPerPoint.x/2); // centering
        for(let i = 1; i < this.drawPoints.y.length; i++) {
            ctx.beginPath();
            if(this.drawPoints.y[i] >= this.canvas.clientHeight) {
                // ctx.rect(this.drawPoints.x[i],
                //     this.canvas.clientHeight/2,
                //     this.pixelsPerPoint.x,
                //     this.drawPoints.y[i] - this.canvas.clientHeight);
                // ctx.strokeStyle = strokeStyle.low;
                // ctx.fillStyle = 'red';
            }
            else {
                ctx.rect(this.drawPoints.x[i],
                    this.drawPoints.y[i],
                    this.pixelsPerPoint.x,
                    this.canvas.clientHeight - this.drawPoints.y[i]);
                ctx.strokeStyle = strokeStyle.high;
                ctx.fillStyle = 'lightblue';
            }
            ctx.fill();
            ctx.stroke();
        }
        return this;
    }

    drawRectangle(xIndex, fill = 'blue', line = 'lightgreen') {
        let ctx = this.canvas.getContext('2d');
        ctx.beginPath();
        ctx.lineStyle = line;
        ctx.fillStyle = fill;
        ctx.lineWidth = this.pixelsPerPoint.x / 4;
        ctx.rect(
            this.drawPoints.x[xIndex],
            this.drawPoints.y[xIndex],
            this.pixelsPerPoint.x,
            this.canvas.clientHeight - this.drawPoints.y[xIndex]);
        ctx.fill();
        ctx.stroke();
        return this;
    }

    highlightColumn(xIndex) {
        let ctx = this.canvas.getContext('2d');
        ctx.beginPath();
        ctx.lineWidth = this.pixelsPerPoint.x / 4;
        ctx.lineStyle = 'lightgreen';
        ctx.fillStyle = 'lightgreen';
        ctx.rect(
            this.drawPoints.x[xIndex],
            0,
            this.pixelsPerPoint.x,
            this.canvas.clientHeight
        );
        ctx.fill();
        ctx.stroke();
        return this;
    }

    /**
     * Draw the moving widget
     * @param centre {{x: number, y: number}} coordinates for the widget's centre
     */
    drawWidget(centre) {
        let ctx = this.canvas.getContext('2d');

        ctx.beginPath();
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.arc(centre.x, centre.y, this.style.widgetSize, 0, 2 * Math.PI);
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        if(this.style.showWidgetLabel)
            this.labelWidget(centre);

        return this;
    }

    labelWidget(widgetPosition) {
        let bet = this.bet.amount;
        let betString = (Math.round(bet*100)/100).toFixed(2);

        let label = {
            text: "$" + betString + " on " + (this.bet.on).toString(),
            font: '14px Arial',
            left: widgetPosition.x + this.style.widgetSize*2,
            width: 100,
            top: widgetPosition.y + this.style.widgetSize,
            height: 10
        };

        if(label.left + label.width > this.canvas.clientWidth)
            label.left -= label.width;

        if(label.top < label.height * 2)
            label.top = label.height * 2;
        if(label.top > this.canvas.clientHeight - label.height)
            label.top = this.canvas.clientHeight - label.height;

        let ctx = this.canvas.getContext('2d');
        ctx.font = label.font;
        ctx.strokeText(label.text, label.left, label.top);

        return this;
    }

    drawToCanvas(clickEvent) {
        // console.log('-----------------')

        if(clickEvent === null)
            return console.log('No click event sent to drawToCanvas');
        if(this.canvas === null) // TODO: better check for canvas usability. Move to constructor?
            return console.log('No canvas defined for drawToCanvas');

        this.updateFromCursor(clickEvent)
            .updateY()
            .recalculateDrawPoints();

        this.clearCanvas()
            .drawRectangles()
            .drawAxisX()
            .drawAxisY();

        this.drawWidget({
            x: this.drawPoints.x[this.bet.index] + this.pixelsPerPoint.x/2,
            y: this.drawPoints.y[this.bet.index]
        });

        return this;
    }

    /**
     * Draw the result by redrawing the display and overlaying a highlighted column.
     * @param result
     * @return {Distribution}
     */
    showResult(result) {
        // Amount won is y proportion * bet step + minPayout
        // this.bet.won = ;
        this.clearCanvas()
            .recalculateDrawPoints()
            .drawRectangles()
            .highlightColumn(this.x.indexOf(result))
            .drawRectangle(this.x.indexOf(result))
            .drawAxisX()
            .drawWidget({
                x: this.drawPoints.x[this.bet.index] + this.pixelsPerPoint.x/2,
                y: this.drawPoints.y[this.bet.index]
            });
        return this;
    }

    /**
     * The gutter runs along the edges of the canvas and is adjusted to ensure the content is centred on the canvas.
     * @return {{x: number, y: number}}
     */
    get gutter() {
        let graphGap = this.canvas.clientWidth - (this.pixelsPerPoint.x * (this.xMax - this.xMin));
        return {
            x: this.style.gutterX + graphGap/2,
            y: this.style.gutterY
        }
    }

    /**
     * Panel is the bit the graph is drawn on: canvas minus gutter and padding
     * @return {{left: *, right: *, top: *, bottom: *, height: *, width: *}}
     */
    get panel() {
        let out = {
            left: this.gutter.x + this.style.paddingX,
            top: this.gutter.y + this.style.paddingY
        };
        out.width = this.canvas.clientWidth - out.left*2;
        out.height = this.canvas.clientHeight - out.top*2;
        out.bottom = out.top + out.height; // saves a lot of repetition
        out.right = out.left + out.width;
        return out;
    }

    /**
     * Scaling factor to map precision ratings to pixels.
     * Precision to pixels = precision * precisionRange
     * Pixels to precision = pixels / precisionRange
     */
    get precisionScale() {
        let precisionRange = this.maxPrecision + this.style.precisionPadding - this.style.precisionStart;
        let pixelRange = this.panel.height;
        return pixelRange/precisionRange;
    }

    /**
     * Scale payout values to pixels
     * @return {number}
     */
    get payoutScale() {
        // find minPrecision as y-coordinate
        let betRange = this.maxBet - this.minBet;
        let precisionRange = this.maxPrecision - this.minPrecision;
        let betAsPrecision = precisionRange / betRange;
        return betAsPrecision * this.precisionScale;
    }

    /**
     * Return a payout or bet value as a y coordinate
     * @param payout {number} payout to plot
     * @return {number} y-coordinate for plotting
     */
    payoutToY(payout) {
        return (this.minPrecision - this.style.precisionStart) * this.precisionScale +
            (payout - this.minBet) * this.payoutScale;
    }

    /**
     * Return a y coordinate as a payout value
     * @param y {number} y-coordinate
     * @return {number} payout value
     */
    yToPayout(y) {
        return this.minBet +
            (y - (this.minPrecision - this.style.precisionStart) * this.precisionScale) / this.payoutScale;
    }

    /**
     * Draw the value axis
     * @param [y] {number} y coordinate at which to draw the axis
     * @return {Distribution} self for chaining
     */
    drawAxisX(y) {
        let ctx = this.canvas.getContext('2d');
        // line
        y = typeof y === "undefined"? this.panel.top + this.panel.height + this.style.axisPositionX : y;
        ctx.strokeStyle = this.style.axisStrokeStyleX;
        ctx.lineWidth = this.style.axisLineWidthX;
        ctx.beginPath();
        ctx.moveTo(this.panel.left, y);
        ctx.lineTo(this.panel.left + this.panel.width, y);
        ctx.strokeStyle = this.style.axisStrokeStyleX;
        ctx.stroke();
        // ticks
        let tickDistance = this.panel.width / this.style.axisTicksX;
        ctx.font = this.style.axisLabelFontX + ' ' + this.style.axisLabelFontSizeX.toString() + 'px';
        ctx.textAlign = 'center';
        let label = "";
        for(let i = 0; i <= this.style.axisTicksX; i++) {
            ctx.moveTo(this.panel.left + i*tickDistance, y);
            ctx.lineTo(this.panel.left + i*tickDistance, y+this.style.axisTickSizeX);
            ctx.stroke();
            label = this.x[i*Math.round(this.x.length / this.style.axisTicksX)];
            ctx.strokeText(label, this.panel.left + i*tickDistance, y + this.style.axisTickSizeX*2);
        }
        return this;
    }

    /**
     * Draw the payout axis
     * @param [x] {number} x coordinate at which to draw the axis
     * @return {Distribution} self for chaining
     */
    drawAxisY(x) {
        // payouts are defined by clamping minBet to minPrecision and maxBet to maxPrecision
        x = typeof x === "undefined"? this.panel.left + this.style.axisPositionY : x;
        let ctx = this.canvas.getContext('2d');
        ctx.strokeStyle = this.style.axisStrokeStyleY;
        ctx.lineWidth = this.style.axisLineWidthY;
        ctx.beginPath();
        ctx.moveTo(x, this.panel.height + this.panel.top);
        ctx.lineTo(x, this.panel.top);
        ctx.stroke();
        // ticks
        let tickDistance = this.panel.height / 10;
        let label = "";
        for(let i = 0; i <= 10; i++) {
            ctx.moveTo(x, this.panel.height + this.panel.top - tickDistance*i);
            ctx.lineTo(x - this.style.axisTickSizeY, this.panel.height + this.panel.top - tickDistance*i);
            ctx.stroke();
            label = this.yToPayout(i*this.panel.height/10).toFixed(2);
            ctx.strokeText(
                label,
                x - this.style.axisTickSizeY*2,
                this.panel.height + this.panel.top - tickDistance*i + this.style.axisLabelFontSizeY/4);
        }
        return this;
    }

    /**
     * Draw guide axes to illustrate the different customisation properties.
     * Draws the following:
     * * Gutters (black fill)
     * * Padding (green fill)
     * * x axis showing % of pixel space (black)
     * * y axis showing x values (black)
     * * min/maxPrecision boundaries (pink)
     * * precision scale from style.precisionStart to maxPrecision+style.precisionPadding (red)
     * * payout scale (black, central)
     * * betting scale over allowed betting space (blue)
     */
    showGuides() {
        let ctx = this.canvas.getContext('2d');

        // Gutters
        // adjust for centering the display
        ctx.beginPath();
        ctx.fillStyle = 'black';
        ctx.fillRect(0,0,this.gutter.x,this.canvas.clientHeight);
        ctx.fillRect(0,0,this.canvas.clientWidth,this.gutter.y);
        ctx.fillRect(0,this.canvas.clientHeight-this.gutter.y,this.canvas.clientWidth,this.gutter.y);
        ctx.fillRect(this.canvas.clientWidth-this.gutter.x,0,this.gutter.x,this.canvas.clientHeight);

        // Padding
        let paddingLeft = this.gutter.x;
        let paddingTop = this.gutter.y;
        let paddingWidth = this.canvas.clientWidth - this.gutter.x*2;
        let paddingHeight = this.canvas.clientHeight - this.gutter.y*2;
        ctx.fillStyle = 'lightgreen';
        ctx.fillRect(paddingLeft, paddingTop, this.style.paddingX, paddingHeight);
        ctx.fillRect(paddingLeft, paddingTop, paddingWidth, this.style.paddingY);
        ctx.fillRect(
            paddingLeft,
            this.canvas.clientHeight - this.gutter.y - this.style.paddingY,
            paddingWidth,
            this.style.paddingY);
        ctx.fillRect(
            this.canvas.clientWidth - this.gutter.x - this.style.paddingX,
            paddingTop,
            this.style.paddingX,
            paddingHeight);

        // Precision limits
        ctx.strokeStyle = 'pink';
        ctx.moveTo(
            this.panel.left,
            this.panel.bottom - (this.maxPrecision - this.style.precisionStart) * this.precisionScale);
        ctx.lineTo(
            this.panel.left + this.panel.width,
            this.panel.bottom - (this.maxPrecision - this.style.precisionStart) * this.precisionScale);
        ctx.stroke();
        ctx.moveTo(
            this.panel.left,
            this.panel.bottom - (this.minPrecision - this.style.precisionStart) * this.precisionScale);
        ctx.lineTo(
            this.panel.left + this.panel.width,
            this.panel.bottom - (this.minPrecision - this.style.precisionStart) * this.precisionScale);
        ctx.stroke();

        // X Axis
        this.drawAxisX();

        // Y Axes

        // 1. Y space
        // line
        let yAxisX = this.panel.left + this.style.axisPositionY;
        ctx.strokeStyle = this.style.axisStrokeStyleY;
        ctx.lineWidth = this.style.axisLineWidthY;
        ctx.beginPath();
        ctx.moveTo(yAxisX, this.panel.bottom);
        ctx.lineTo(yAxisX, this.panel.top);
        ctx.stroke();

        // tics
        let tickDistance = this.panel.height / this.style.axisTicksY;
        ctx.font = this.style.axisLabelFontY + ' ' + this.style.axisLabelFontSizeY.toString() + 'px';
        ctx.textAlign = 'right';
        let label = "";
        for(let i = 0; i <= this.style.axisTicksY; i++) {
            ctx.moveTo(yAxisX, this.panel.bottom - tickDistance*i);
            ctx.lineTo(yAxisX - this.style.axisTickSizeY, this.panel.bottom - tickDistance*i);
            ctx.stroke();
            label = Math.round(100/this.style.axisTicksY*i).toFixed(1);
            ctx.strokeText(
                label,
                yAxisX - this.style.axisTickSizeY*2,
                this.panel.height + this.panel.top - tickDistance*i + this.style.axisLabelFontSizeY/4);
        }

        // 2. Precision space
        // draw another y axis indented a bit which shows the precision space
        let precisionX = this.panel.left + this.panel.width * .25;
        ctx.strokeStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(precisionX, this.panel.bottom);
        ctx.lineTo(
            precisionX,
            this.panel.bottom - (this.maxPrecision - this.style.precisionStart)*this.precisionScale);
        ctx.stroke();
        // ticks
        tickDistance = (this.maxPrecision - this.style.precisionStart) / 10 * this.precisionScale;
        label = "";
        for(let i = 0; i <= 10; i++) {
            ctx.moveTo(precisionX, this.panel.bottom - tickDistance*i);
            ctx.lineTo(precisionX - this.style.axisTickSizeY, this.panel.bottom - tickDistance*i);
            ctx.stroke();
            label = (this.style.precisionStart + i*(this.maxPrecision - this.style.precisionStart)/10).toFixed(2);
            ctx.strokeText(
                label,
                precisionX - this.style.axisTickSizeY*2,
                this.panel.height + this.panel.top - tickDistance*i + this.style.axisLabelFontSizeY/4);
        }

        // 3. Payout space
        this.drawAxisY(this.panel.left + this.panel.width * .5);

        // 4. Betting space
        // betting space is defined by the minBet for minPrecision and maxBet for maxPrecision
        let betX = this.panel.left + this.panel.width * .75;
        let betY = this.panel.bottom - this.payoutToY(this.minBet);
        ctx.strokeStyle = 'blue';
        ctx.beginPath();
        ctx.moveTo(betX, betY);
        ctx.lineTo(betX, this.panel.bottom - this.payoutToY(this.maxBet));
        ctx.stroke();
        // ticks
        tickDistance = (this.maxBet - this.minBet) * this.payoutScale / 10;
        label = "";
        for(let i = 0; i <= 10; i++) {
            ctx.moveTo(betX, betY - tickDistance*i);
            ctx.lineTo(betX - this.style.axisTickSizeY, betY - tickDistance*i);
            ctx.stroke();
            label = (this.minBet + i*(this.maxBet - this.minBet)/10).toFixed(2);
            ctx.strokeText(
                label,
                betX - this.style.axisTickSizeY*2,
                betY - tickDistance*i + this.style.axisLabelFontSizeY/4);
        }
    }
}

class utils {
    /**
     * Find the minimum value in arr[]
     * @param arr {number[]}
     * @return {number}
     */
    static getMin(arr) {
        return(arr.reduce((a,b)=>Math.min(a,b)));
    }

    /**
     * Find the maximum value in arr[]
     * @param arr {number[]}
     * @return {number}
     */
    static getMax(arr) {
        return(arr.reduce((a,b)=>Math.max(a,b)));
    }

    /**
     * Add val to each element of arr
     * @param arr {number[]}
     * @param val {number}
     * @return {number[]}
     */
    static add(arr, val) {
        let newArr = [];
        for(let i = 0; i < arr.length; i++)
            newArr[i] = arr[i] + val;
        return newArr;
    }

    /**
     * Return the sum of elements in arr
     * @param arr {number[]}
     * @return {number}
     */
    static sum(arr) {
        let total = 0;
        for(let i = 0; i < arr.length; i++)
            total += arr[i];
        return total;
    }
}

export {Distribution};