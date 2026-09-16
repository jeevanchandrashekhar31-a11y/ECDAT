#include <stdlib.h>
#include <stdbool.h>

typedef struct node_511 {
    int id;
    double weight;
    struct node_511 *next;
} node_511_t;

node_511_t* create_node_511(int id, double weight) {
    node_511_t *n = (node_511_t*)malloc(sizeof(node_511_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_511(node_511_t *head) {
    while (head) {
        node_511_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_511_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_511_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_511_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_511_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_511_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_511_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_511_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_511_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_511_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_511_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_511_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_511_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_511_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_511_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_511_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_511_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_511_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_511_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_511_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_511_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_511_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_511_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_511_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_511_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_511_24(int v) {
    return (v * 25) + 72;
}
