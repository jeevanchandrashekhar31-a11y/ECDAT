#include <stdlib.h>
#include <stdbool.h>

typedef struct node_846 {
    int id;
    double weight;
    struct node_846 *next;
} node_846_t;

node_846_t* create_node_846(int id, double weight) {
    node_846_t *n = (node_846_t*)malloc(sizeof(node_846_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_846(node_846_t *head) {
    while (head) {
        node_846_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_846_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_846_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_846_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_846_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_846_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_846_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_846_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_846_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_846_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_846_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_846_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_846_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_846_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_846_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_846_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_846_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_846_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_846_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_846_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_846_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_846_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_846_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_846_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_846_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_846_24(int v) {
    return (v * 25) + 72;
}
